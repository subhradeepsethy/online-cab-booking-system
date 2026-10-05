import { env } from '../config/env.js';
import { parseCookies, sessionCookieName } from '../lib/cookies.js';
import { HttpError } from '../lib/httpError.js';
import { roles, userFromToken } from '../lib/users.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

// Same-host requests, or origins explicitly allowed by CORS_ORIGIN. The host is compared rather
// than the full origin because a TLS-terminating proxy (the Vite dev server, a load balancer)
// can make the browser's https:// origin arrive here over plain http. Browsers set Origin
// themselves, so another website can't fake it.
function isTrustedOrigin(request) {
  const origin = request.get('origin');
  if (!origin) return true;
  if (env.corsOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === request.get('host');
  } catch {
    return false;
  }
}

// Finds the session token for this request. Browsers use the HttpOnly cookie for the role named
// in the X-Session-Role header; API clients (and tests) can send `Authorization: Bearer <token>`.
// Returns { token, viaCookie } or null.
export function sessionToken(request) {
  const header = request.get('authorization') ?? '';
  if (header.startsWith('Bearer ')) return { token: header.slice(7).trim(), viaCookie: false };

  const role = request.get('x-session-role');
  if (!roles.includes(role)) return null;
  const token = parseCookies(request.get('cookie'))[sessionCookieName(role)];
  return token ? { token, viaCookie: true } : null;
}

export const blockedError = () => new HttpError(403, 'ACCOUNT_BLOCKED', 'Your account has been suspended. Contact support for help.');

// CSRF defence for cookie sessions, on top of SameSite=Strict: state-changing requests must come
// from a trusted origin and carry the custom X-Session-Role header (which a form on another site
// can't add, and which forces a CORS preflight for cross-origin scripts).
function assertCsrfSafe(request) {
  if (safeMethods.has(request.method)) return;
  if (!isTrustedOrigin(request)) {
    throw new HttpError(403, 'BAD_ORIGIN', 'This request was blocked because it came from another website.');
  }
}

export function requireAuth(...allowedRoles) {
  return (request, _response, next) => {
    const session = sessionToken(request);
    const user = session ? userFromToken(session.token) : null;

    if (!user) {
      return next(new HttpError(401, 'UNAUTHORIZED', 'Please log in to continue.'));
    }

    if (session.viaCookie) {
      try {
        assertCsrfSafe(request);
      } catch (error) {
        return next(error);
      }
    }

    if (user.blocked) {
      return next(blockedError());
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      return next(new HttpError(403, 'FORBIDDEN', 'Your account cannot perform this action.'));
    }

    request.user = user;
    return next();
  };
}

// Attaches the user when a valid session is sent, but lets anonymous requests through.
export function optionalAuth(request, _response, next) {
  const session = sessionToken(request);
  const user = session ? userFromToken(session.token) : null;
  if (user && !user.blocked && (!session.viaCookie || safeMethods.has(request.method) || isTrustedOrigin(request))) {
    request.user = user;
  }
  next();
}

export { isTrustedOrigin };
