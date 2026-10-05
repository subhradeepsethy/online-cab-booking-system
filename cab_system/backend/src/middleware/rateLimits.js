import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const minutes = (value) => value * 60 * 1000;

const tooMany = (message) => ({ error: { code: 'TOO_MANY_REQUESTS', message } });

const limiter = (options) => rateLimit({ standardHeaders: 'draft-8', legacyHeaders: false, ...options });

// Limits per logged-in account where possible (fair for users sharing an IP, e.g. mobile
// carriers), falling back to the client IP.
const byUserOrIp = (request) => (request.user ? `user:${request.user.id}` : ipKeyGenerator(request.ip));

// Ride and driver screens refresh in the background, so the general limit is generous.
export const apiLimiter = limiter({
  windowMs: minutes(15),
  limit: 1500,
  message: tooMany('Too many requests. Please slow down and try again shortly.'),
});

export const authLimiter = limiter({
  windowMs: minutes(15),
  limit: 20,
  message: tooMany('Too many login or sign-up attempts. Please try again in a few minutes.'),
});

// SMS costs money and can be used to spam people, so code requests are limited per IP here and
// per phone number (cooldown and hourly cap) inside lib/otp.js.
export const otpLimiter = limiter({
  windowMs: minutes(15),
  limit: 30,
  message: tooMany('Too many verification codes requested. Please try again later.'),
});

export const bookingLimiter = limiter({
  windowMs: minutes(15),
  limit: 20,
  keyGenerator: byUserOrIp,
  message: tooMany('Too many ride requests. Please wait a few minutes.'),
});

export const uploadLimiter = limiter({
  windowMs: minutes(60),
  limit: 20,
  keyGenerator: byUserOrIp,
  message: tooMany('Too many uploads. Please try again later.'),
});
