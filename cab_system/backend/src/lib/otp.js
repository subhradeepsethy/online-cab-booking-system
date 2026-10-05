import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { badRequest, HttpError } from './httpError.js';
import { sendOtpSms } from './sms.js';
import { findUserByPhone, normalizePhone, signupRoles } from './users.js';

export const otpPurposes = ['signup', 'reset'];

const codeLifetimeMs = 10 * 60 * 1000;
const resendCooldownMs = 60 * 1000;
const maxSendsPerHour = 5;
const maxVerifyAttempts = 5;
const maxTracked = 20_000;

// Pending codes live in memory: they are short-lived, and a restart simply means asking for a
// new code. Only an HMAC of each code is stored, never the code itself.
const challenges = new Map();
const sendLog = new Map();

const keyFor = (purpose, role, phone) => `${purpose}:${role}:${phone}`;
const hashCode = (key, code) => crypto.createHmac('sha256', env.authSecret).update(`${key}:${code}`).digest();

function validate(purpose, role, phone) {
  if (!otpPurposes.includes(purpose)) throw badRequest('INVALID_PURPOSE', 'Unknown verification purpose.');
  if (!signupRoles.includes(role)) throw badRequest('INVALID_ROLE', 'Choose rider or driver.');
  if (!/^[6-9]\d{9}$/.test(phone)) throw badRequest('INVALID_PHONE', 'Enter a valid 10-digit Indian mobile number.');
}

function prune(now) {
  for (const [key, challenge] of challenges) if (challenge.expiresAt <= now) challenges.delete(key);
  for (const [phone, times] of sendLog) {
    const recent = times.filter((time) => now - time < 60 * 60 * 1000);
    if (recent.length === 0) sendLog.delete(phone); else sendLog.set(phone, recent);
  }
}

// Returns { sent: true } plus `devCode` when using the console provider outside production,
// so the flow can be tested locally without an SMS account.
export async function requestOtp({ purpose, role, phone: rawPhone }) {
  const phone = normalizePhone(rawPhone);
  validate(purpose, role, phone);
  const now = Date.now();
  prune(now);

  const exists = Boolean(findUserByPhone(role, phone));
  if (purpose === 'signup' && exists) {
    throw new HttpError(409, 'PHONE_TAKEN', 'An account with this mobile number already exists. Log in instead.');
  }

  const key = keyFor(purpose, role, phone);
  const previous = challenges.get(key);
  if (previous && now - previous.sentAt < resendCooldownMs) {
    const wait = Math.ceil((resendCooldownMs - (now - previous.sentAt)) / 1000);
    throw new HttpError(429, 'OTP_COOLDOWN', `Please wait ${wait} seconds before requesting another code.`);
  }
  const sentRecently = sendLog.get(phone) ?? [];
  if (sentRecently.length >= maxSendsPerHour) {
    throw new HttpError(429, 'OTP_LIMIT', 'Too many codes requested for this number. Try again in an hour.');
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  // For password resets of unknown numbers nothing is sent, but cooldowns and limits are tracked
  // exactly the same, so this endpoint can't be used to discover which numbers are registered.
  // The stored hash is of a code nobody received, so it can never be verified.
  if (purpose !== 'reset' || exists) await sendOtpSms(phone, code);

  if (challenges.size >= maxTracked) challenges.delete(challenges.keys().next().value);
  challenges.set(key, { codeHash: hashCode(key, code), expiresAt: now + codeLifetimeMs, attempts: 0, sentAt: now });
  sendLog.set(phone, [...sentRecently, now]);

  if (purpose === 'reset' && !exists) return { sent: true };

  const exposeCode = env.sms.provider === 'console' && !env.isProduction;
  return exposeCode ? { sent: true, devCode: code } : { sent: true };
}

// Checks and consumes a code. Throws if it's wrong, expired or out of attempts.
export function verifyOtp({ purpose, role, phone: rawPhone, code }) {
  const phone = normalizePhone(rawPhone);
  const key = keyFor(purpose, role, phone);
  const challenge = challenges.get(key);
  const invalid = () => badRequest('INVALID_OTP', 'That code is incorrect or has expired. Request a new one.');

  if (!challenge || challenge.expiresAt <= Date.now()) {
    challenges.delete(key);
    throw invalid();
  }
  if (challenge.attempts >= maxVerifyAttempts) {
    challenges.delete(key);
    throw new HttpError(429, 'OTP_LOCKED', 'Too many wrong codes. Request a new one.');
  }

  const submitted = typeof code === 'string' ? code.trim() : String(code ?? '');
  const matches = /^\d{6}$/.test(submitted) && crypto.timingSafeEqual(hashCode(key, submitted), challenge.codeHash);
  if (!matches) {
    challenge.attempts += 1;
    throw invalid();
  }
  challenges.delete(key);
}
