import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter, authLimiter, otpLimiter } from './middleware/rateLimits.js';
import adminRouter from './routes/admin.routes.js';
import authRouter from './routes/auth.routes.js';
import driverRouter from './routes/driver.routes.js';
import healthRouter from './routes/health.routes.js';
import meRouter from './routes/me.routes.js';
import ridesRouter from './routes/rides.routes.js';

const app = express();

app.disable('x-powered-by');
// Behind a proxy, use the real client IP for rate limiting instead of the proxy's.
app.set('trust proxy', env.trustProxy);

// Google Maps, Places and fonts need these hosts (per Google's Maps JavaScript API CSP guide).
const googleHosts = ['https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', 'https://*.ggpht.com', 'https://*.googleusercontent.com'];

// The API only returns JSON and documents: nothing should run, load or frame from it.
const apiHelmet = helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
});

// The website (when served from here): scripts only from this site and Google Maps, data only
// to this site and Google, and the page can't be framed by other sites (clickjacking).
const siteHelmet = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...googleHosts],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', ...googleHosts],
      connectSrc: ["'self'", ...googleHosts],
      frameSrc: googleHosts,
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

app.use((request, response, next) => (
  request.path.startsWith('/api') || request.path.startsWith('/socket.io')
    ? apiHelmet(request, response, next)
    : siteHelmet(request, response, next)
));
app.use(cors({ origin: env.corsOrigins, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], maxAge: 600 }));

// Driver document uploads (base64 JSON, files up to 3 MB) get a larger body limit, but only
// after authentication inside the driver router; every other route is capped at 100 KB.
const jsonParser = express.json({ limit: '100kb' });
app.use((request, response, next) => (
  request.path.startsWith('/api/driver/documents/') ? next() : jsonParser(request, response, next)
));

app.use(morgan(env.isProduction ? 'combined' : 'dev', {
  // Ride screens poll; logging every successful GET drowns out useful output in development.
  skip: (request, response) => !env.isProduction && request.method === 'GET' && response.statusCode < 400,
}));

// API responses carry personal data; never let browsers or proxies cache them.
app.use('/api', (_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', apiLimiter);

app.use('/api/health', healthRouter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/password', authLimiter);
app.use('/api/auth/otp', otpLimiter);
app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/rides', ridesRouter);
app.use('/api/driver', driverRouter);
app.use('/api/admin', adminRouter);
app.use('/api', notFoundHandler);

// Serve the built website from the same origin as the API (production). One origin means
// SameSite cookies just work, no cross-site CORS is needed, and there's one service to deploy.
const indexFile = env.staticDir ? path.join(env.staticDir, 'index.html') : '';
if (indexFile && fs.existsSync(indexFile)) {
  app.use(express.static(env.staticDir, {
    index: false,
    setHeaders: (response, filePath) => {
      // Hashed asset files never change, so they can be cached for a long time.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) response.set('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  // Single-page app: every other GET returns index.html and React Router takes over.
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/socket.io')) return next();
    response.set('Cache-Control', 'no-cache');
    return response.sendFile(indexFile);
  });
} else {
  app.get('/', (_request, response) => {
    response.json({ service: 'cab-system-api', message: 'This is the API server. Open the web app instead.' });
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
