import { env } from '../config/env.js';
import { tokenLifetimeMs } from './auth.js';

// One session cookie per role, so a browser can be logged in as rider, driver and admin at once.
// In production the __Host- prefix makes the browser enforce Secure, Path=/ and no Domain, so
// the cookie can't be set or overwritten by another subdomain.
export const sessionCookieName = (role) => `${env.isProduction ? '__Host-' : ''}cab_session_${role}`;

export function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string' || header.length > 8192) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!Object.hasOwn(cookies, name)) {
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        // Ignore malformed cookie values.
      }
    }
  }
  return cookies;
}

function serialize(name, value, maxAgeSeconds) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    // Strict: the cookie is never sent on requests started by other websites (CSRF defence).
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (env.isProduction) attributes.push('Secure');
  return attributes.join('; ');
}

export function setSessionCookie(response, user, token) {
  response.append('Set-Cookie', serialize(sessionCookieName(user.role), token, Math.floor(tokenLifetimeMs(user.role) / 1000)));
}

export function clearSessionCookie(response, role) {
  response.append('Set-Cookie', serialize(sessionCookieName(role), '', 0));
}
