import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const port = Number.parseInt(process.env.PORT ?? '5000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';
const flag = (name, fallback) => (process.env[name] ?? String(fallback)).trim().toLowerCase() === 'true';

// Comma-separated list of exact origins allowed to call the API from a browser.
const corsOrigins = (process.env.CORS_ORIGIN ?? (isProduction ? '' : 'http://localhost:5173'))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const authSecret = process.env.AUTH_SECRET ?? '';
const seedDemoAccounts = flag('SEED_DEMO_ACCOUNTS', false);

// SMS for phone verification codes: "twilio", "msg91", or "console" (prints codes to the server
// log; local development only).
const smsProvider = (process.env.SMS_PROVIDER ?? 'console').trim().toLowerCase();
const requirePhoneVerification = flag('REQUIRE_PHONE_VERIFICATION', true);
const sms = {
  provider: smsProvider,
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    // A sender phone number (+1...) or a Messaging Service SID (MG...).
    from: process.env.TWILIO_FROM ?? '',
  },
  msg91: {
    authKey: process.env.MSG91_AUTH_KEY ?? '',
    templateId: process.env.MSG91_TEMPLATE_ID ?? '',
  },
};

const smsProblems = [];
if (!['console', 'twilio', 'msg91'].includes(smsProvider)) smsProblems.push('SMS_PROVIDER must be console, twilio or msg91.');
if (smsProvider === 'twilio' && (!sms.twilio.accountSid || !sms.twilio.authToken || !sms.twilio.from)) {
  smsProblems.push('SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM.');
}
if (smsProvider === 'msg91' && (!sms.msg91.authKey || !sms.msg91.templateId)) {
  smsProblems.push('SMS_PROVIDER=msg91 needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID.');
}
if (smsProblems.length > 0) throw new Error(`SMS configuration error:\n- ${smsProblems.join('\n- ')}`);

// Refuse to start production with settings that would make the deployment easy to attack.
if (isProduction) {
  const problems = [];
  if (authSecret.length < 32 || authSecret.startsWith('change_me')) {
    problems.push('AUTH_SECRET must be set to a random string of at least 32 characters.');
  }
  if (corsOrigins.length === 0) problems.push('CORS_ORIGIN must list the website origin(s), e.g. https://cabs.example.com.');
  if (corsOrigins.includes('*')) problems.push('CORS_ORIGIN must not be "*".');
  if (corsOrigins.some((origin) => !origin.startsWith('https://'))) problems.push('CORS_ORIGIN must use https:// origins.');
  if (seedDemoAccounts) problems.push('SEED_DEMO_ACCOUNTS must be false: demo accounts have publicly known passwords.');
  if (smsProvider === 'console' && requirePhoneVerification) {
    problems.push('SMS_PROVIDER=console only prints codes to the log. Configure twilio or msg91 for real phone verification.');
  }
  if (problems.length > 0) {
    throw new Error(`Unsafe production configuration:\n- ${problems.join('\n- ')}`);
  }
}

// Number of reverse proxies (load balancer, Nginx, Render, etc.) in front of the API, so rate
// limits see the real client IP. Leave unset when the API is reached directly.
const trustProxy = Number.parseInt(process.env.TRUST_PROXY ?? '0', 10);

export const env = Object.freeze({
  nodeEnv,
  isProduction,
  port,
  corsOrigins,
  // Outside production a random per-process secret keeps things working without config, at the
  // cost of logging everyone out on restart. Set AUTH_SECRET to keep sessions across restarts.
  authSecret: authSecret || crypto.randomBytes(32).toString('hex'),
  // Folder holding the SQLite database and uploaded documents. DATA_FILE (the old JSON setting)
  // is still honoured so existing setups keep finding their data folder.
  dataDir: process.env.DATA_DIR ?? path.dirname(process.env.DATA_FILE ?? 'data/db.json'),
  seedDemoAccounts,
  // New drivers must be approved by an admin (after document review) before going online.
  requireDriverApproval: flag('REQUIRE_DRIVER_APPROVAL', true),
  // Optional operator account created on startup, e.g. for production where demo seeding is off.
  adminPhone: process.env.ADMIN_PHONE ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  trustProxy: Number.isInteger(trustProxy) && trustProxy > 0 ? trustProxy : false,
  requirePhoneVerification,
  sms,
  // Built website to serve from this server (one origin for site + API). On by default in
  // production only; in development the Vite dev server serves the site. Empty disables it.
  staticDir: process.env.STATIC_DIR
    ?? (isProduction ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../frontend/dist') : ''),
});
