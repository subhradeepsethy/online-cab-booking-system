import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../config/env.js';

const scrypt = promisify(crypto.scrypt);

// OWASP-recommended scrypt cost (N=2^17, r=8, p=1, about 128 MiB per hash). The parameters are
// stored with each hash so they can be raised later without breaking existing passwords.
const currentParams = { N: 2 ** 17, r: 8, p: 1 };
// Hashes created before parameters were stored used Node's scrypt defaults.
const legacyParams = { N: 2 ** 14, r: 8, p: 1 };
const keyLength = 64;

const maxmem = (params) => 128 * params.N * params.r * 2;

async function derive(password, salt, params) {
  return scrypt(password.normalize('NFKC'), salt, keyLength, { ...params, maxmem: maxmem(params) });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await derive(password, salt, currentParams);
  return `scrypt$${currentParams.N}$${currentParams.r}$${currentParams.p}$${salt}$${hash.toString('hex')}`;
}

function parseHash(storedHash) {
  const parts = String(storedHash ?? '').split('$');
  if (parts.length === 6 && parts[0] === 'scrypt') {
    const [, N, r, p, salt, hash] = parts;
    return { params: { N: Number(N), r: Number(r), p: Number(p) }, salt, hash };
  }
  const [salt, hash] = String(storedHash ?? '').split(':');
  return salt && hash ? { params: legacyParams, salt, hash } : null;
}

// A real hash of a random password, so logins for unknown accounts take as long as real ones
// and response timing can't reveal which phone numbers are registered.
const dummyHashPromise = hashPassword(crypto.randomBytes(16).toString('hex'));

export async function verifyPassword(password, storedHash) {
  const parsed = parseHash(storedHash);
  if (!parsed || typeof password !== 'string') {
    await verifyPassword('invalid', await dummyHashPromise);
    return false;
  }

  const expected = Buffer.from(parsed.hash, 'hex');
  const actual = await derive(password, parsed.salt, parsed.params);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function burnPasswordCheck(password) {
  await verifyPassword(typeof password === 'string' ? password : '', await dummyHashPromise);
}

export function needsRehash(storedHash) {
  const parsed = parseHash(storedHash);
  return !parsed || parsed.params.N < currentParams.N || parsed.params.r !== currentParams.r || parsed.params.p !== currentParams.p;
}

// Admin sessions are kept short because an admin token can change other people's accounts.
export const tokenLifetimeMs = (role) => (role === 'admin' ? 12 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000);

function sign(value) {
  return crypto.createHmac('sha256', env.authSecret).update(value).digest('base64url');
}

export function createToken(user) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    // Bumping the user's tokenVersion (logout, block) revokes every token issued before it.
    ver: user.tokenVersion ?? 0,
    iat: now,
    exp: now + tokenLifetimeMs(user.role),
  })).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims.sub === 'string' && typeof claims.exp === 'number' && claims.exp > Date.now() ? claims : null;
  } catch {
    return null;
  }
}
