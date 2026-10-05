// Per-account brute-force protection, on top of the per-IP rate limit: after too many wrong
// passwords for one account, that account's logins pause for a while. The lock is short so an
// attacker can't keep a real user locked out for long.
const maxFailures = 5;
const windowMs = 15 * 60 * 1000;
const lockMs = 15 * 60 * 1000;
const maxTracked = 10_000;

const attempts = new Map();

export function loginLockedFor(key, now = Date.now()) {
  const entry = attempts.get(key);
  if (!entry?.lockedUntil) return 0;
  if (entry.lockedUntil <= now) {
    attempts.delete(key);
    return 0;
  }
  return entry.lockedUntil - now;
}

export function recordLoginFailure(key, now = Date.now()) {
  let entry = attempts.get(key);
  if (!entry || now - entry.firstAt > windowMs) entry = { failures: 0, firstAt: now, lockedUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= maxFailures) entry.lockedUntil = now + lockMs;
  attempts.set(key, entry);

  // Keep memory bounded if someone sprays many different numbers.
  if (attempts.size > maxTracked) attempts.delete(attempts.keys().next().value);
}

export function clearLoginFailures(key) {
  attempts.delete(key);
}
