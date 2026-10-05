import { Router } from 'express';
import { env } from '../config/env.js';
import { burnPasswordCheck, createToken, hashPassword, needsRehash, verifyPassword } from '../lib/auth.js';
import { clearSessionCookie, setSessionCookie } from '../lib/cookies.js';
import { HttpError } from '../lib/httpError.js';
import { clearLoginFailures, loginLockedFor, recordLoginFailure } from '../lib/loginGuard.js';
import { requestOtp, verifyOtp } from '../lib/otp.js';
import { disconnectUser } from '../lib/realtime.js';
import { save } from '../lib/store.js';
import {
  createUser,
  findUserByPhone,
  normalizePhone,
  publicUser,
  revokeSessions,
  roles,
  signupRoles,
  validatePassword,
} from '../lib/users.js';
import { blockedError, isTrustedOrigin, requireAuth } from '../middleware/auth.js';

const authRouter = Router();

const invalidCredentials = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect mobile number or password.');

// Login/sign-up forms on other websites must not be able to post here (login CSRF).
authRouter.use((request, _response, next) => {
  if (request.method === 'POST' && !isTrustedOrigin(request)) {
    return next(new HttpError(403, 'BAD_ORIGIN', 'This request was blocked because it came from another website.'));
  }
  return next();
});

// Browsers get the session as an HttpOnly cookie that page scripts can't read. Non-browser
// clients (and the test suite) can ask for the token in the body with `X-Auth-Mode: token`.
function startSession(request, response, user, status = 200) {
  const token = createToken(user);
  setSessionCookie(response, user, token);
  const body = { user: publicUser(user) };
  if (request.get('x-auth-mode') === 'token') body.token = token;
  response.status(status).json(body);
}

authRouter.post('/otp', async (request, response) => {
  const { purpose, role, phone } = request.body ?? {};
  response.json(await requestOtp({ purpose, role, phone }));
});

authRouter.post('/register', async (request, response) => {
  const body = request.body ?? {};
  const verifyPhone = env.requirePhoneVerification
    ? (phone) => verifyOtp({ purpose: 'signup', role: body.role, phone, code: body.otpCode })
    : undefined;
  const user = await createUser(body, { verifyPhone });
  startSession(request, response, user, 201);
});

authRouter.post('/login', async (request, response) => {
  const { role, phone, password } = request.body ?? {};
  const normalizedPhone = normalizePhone(phone);
  const guardKey = `${role}:${normalizedPhone}`;

  const lockedMs = loginLockedFor(guardKey);
  if (lockedMs > 0) {
    throw new HttpError(429, 'TOO_MANY_ATTEMPTS', `Too many failed attempts. Try again in ${Math.ceil(lockedMs / 60000)} minutes.`);
  }

  const user = roles.includes(role) ? findUserByPhone(role, normalizedPhone) : null;
  if (!user) {
    // Same work as a real check, so timing doesn't reveal whether the number is registered.
    await burnPasswordCheck(password);
    recordLoginFailure(guardKey);
    throw invalidCredentials();
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    recordLoginFailure(guardKey);
    throw invalidCredentials();
  }
  clearLoginFailures(guardKey);

  if (user.blocked) throw blockedError();

  // Upgrade hashes made with older, weaker parameters now that we know the password.
  if (needsRehash(user.passwordHash)) {
    user.passwordHash = await hashPassword(password);
    save(user);
  }

  startSession(request, response, user);
});

// Resets a forgotten password with an SMS code, and logs the account out everywhere.
authRouter.post('/password/reset', async (request, response) => {
  const { role, phone, otpCode, newPassword } = request.body ?? {};
  if (!signupRoles.includes(role)) throw new HttpError(400, 'INVALID_ROLE', 'Choose rider or driver.');
  validatePassword(newPassword, role);

  const normalizedPhone = normalizePhone(phone);
  verifyOtp({ purpose: 'reset', role, phone: normalizedPhone, code: otpCode });
  const user = findUserByPhone(role, normalizedPhone);
  if (!user) throw new HttpError(400, 'INVALID_OTP', 'That code is incorrect or has expired. Request a new one.');

  user.passwordHash = await hashPassword(newPassword);
  revokeSessions(user);
  disconnectUser(user.id);
  clearLoginFailures(`${role}:${normalizedPhone}`);
  response.status(204).end();
});

authRouter.get('/me', requireAuth(), (request, response) => {
  response.json({ user: publicUser(request.user) });
});

// Revokes every session for this account (all devices), so a stolen token stops working too.
authRouter.post('/logout', requireAuth(), (request, response) => {
  revokeSessions(request.user);
  disconnectUser(request.user.id);
  clearSessionCookie(response, request.user.role);
  response.status(204).end();
});

export default authRouter;
