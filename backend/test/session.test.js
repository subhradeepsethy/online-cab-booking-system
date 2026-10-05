import assert from 'node:assert/strict';
import test from 'node:test';
import { env } from '../src/config/env.js';
import { nextPhone, registerCustomer, requestSignupCode, startServer } from './helpers.js';

const trustedOrigin = env.corsOrigins[0];
// Browser-style request: no bearer token and no token in the body.
const browser = { 'X-Auth-Mode': '' };

const cookieFrom = (headers) => headers.get('set-cookie')?.split(';')[0] ?? '';

test('browser sign-up and login use an HttpOnly SameSite cookie, not a readable token', async (context) => {
  const request = await startServer(context);
  const phone = nextPhone();
  const otpCode = await requestSignupCode(request, 'customer', phone);

  const registered = await request('/api/auth/register', {
    method: 'POST',
    headers: { ...browser, Origin: trustedOrigin },
    body: { role: 'customer', name: 'Asha', phone, password: 'secret123', otpCode },
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.token, undefined, 'token is never exposed to page scripts');
  const setCookie = registered.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);

  const cookie = cookieFrom(registered.headers);
  const me = await request('/api/auth/me', { headers: { ...browser, Cookie: cookie, 'X-Session-Role': 'customer' } });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.phone, phone);

  const noRole = await request('/api/auth/me', { headers: { ...browser, Cookie: cookie } });
  assert.equal(noRole.status, 401, 'the cookie is only used together with the X-Session-Role header');

  const wrongRole = await request('/api/auth/me', { headers: { ...browser, Cookie: cookie, 'X-Session-Role': 'driver' } });
  assert.equal(wrongRole.status, 401, "a rider cookie can't be used as a driver session");
});

test('cookie sessions reject state-changing requests from other websites (CSRF)', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { ...browser, Origin: trustedOrigin },
    body: { role: 'customer', phone: customer.user.phone, password: 'secret123' },
  });
  const cookie = cookieFrom(login.headers);
  const place = { address: 'Home Street' };

  const forged = await request('/api/me/places/home', {
    method: 'PUT',
    headers: { ...browser, Cookie: cookie, 'X-Session-Role': 'customer', Origin: 'https://evil.example' },
    body: place,
  });
  assert.equal(forged.status, 403);
  assert.equal(forged.body.error.code, 'BAD_ORIGIN');

  const genuine = await request('/api/me/places/home', {
    method: 'PUT',
    headers: { ...browser, Cookie: cookie, 'X-Session-Role': 'customer', Origin: trustedOrigin },
    body: place,
  });
  assert.equal(genuine.status, 200);

  const loginCsrf = await request('/api/auth/login', {
    method: 'POST',
    headers: { ...browser, Origin: 'https://evil.example' },
    body: { role: 'customer', phone: customer.user.phone, password: 'secret123' },
  });
  assert.equal(loginCsrf.status, 403, 'other sites cannot log a visitor in either');
});

test('logout clears the cookie and revokes it on the server', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { ...browser, Origin: trustedOrigin },
    body: { role: 'customer', phone: customer.user.phone, password: 'secret123' },
  });
  const cookie = cookieFrom(login.headers);
  const session = { ...browser, Cookie: cookie, 'X-Session-Role': 'customer', Origin: trustedOrigin };

  const logout = await request('/api/auth/logout', { method: 'POST', headers: session });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);

  // Even if someone kept a copy of the cookie, it no longer works.
  assert.equal((await request('/api/auth/me', { headers: session })).status, 401);
});

test('sign-up codes: wrong codes, attempt limits and resend cooldown', async (context) => {
  const request = await startServer(context);
  const phone = nextPhone();
  const code = await requestSignupCode(request, 'customer', phone);
  assert.match(code, /^\d{6}$/);

  const again = await request('/api/auth/otp', { method: 'POST', body: { purpose: 'signup', role: 'customer', phone } });
  assert.equal(again.status, 429);
  assert.equal(again.body.error.code, 'OTP_COOLDOWN');

  const wrongCode = code === '000000' ? '111111' : '000000';
  const fields = { role: 'customer', name: 'Asha', phone, password: 'secret123' };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request('/api/auth/register', { method: 'POST', body: { ...fields, otpCode: wrongCode } });
    assert.equal(response.body.error.code, 'INVALID_OTP');
  }
  const locked = await request('/api/auth/register', { method: 'POST', body: { ...fields, otpCode: code } });
  assert.equal(locked.status, 429, 'the right code no longer works after 5 wrong tries');

  const taken = await registerCustomer(request);
  const duplicate = await request('/api/auth/otp', { method: 'POST', body: { purpose: 'signup', role: 'customer', phone: taken.user.phone } });
  assert.equal(duplicate.body.error.code, 'PHONE_TAKEN');
});

test('forgot password: reset with an SMS code logs out every session', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const { phone } = customer.user;

  const unknown = await request('/api/auth/otp', { method: 'POST', body: { purpose: 'reset', role: 'customer', phone: nextPhone() } });
  assert.equal(unknown.status, 200, 'unknown numbers look the same, so accounts cannot be discovered');
  assert.equal(unknown.body.devCode, undefined);

  const sent = await request('/api/auth/otp', { method: 'POST', body: { purpose: 'reset', role: 'customer', phone } });
  const weak = await request('/api/auth/password/reset', {
    method: 'POST', body: { role: 'customer', phone, otpCode: sent.body.devCode, newPassword: 'short' },
  });
  assert.equal(weak.body.error.code, 'INVALID_PASSWORD', 'checked before the code is used up');

  const reset = await request('/api/auth/password/reset', {
    method: 'POST', body: { role: 'customer', phone, otpCode: sent.body.devCode, newPassword: 'brand-new-pass' },
  });
  assert.equal(reset.status, 204);

  assert.equal((await request('/api/auth/me', { token: customer.token })).status, 401, 'old sessions are revoked');
  const oldPassword = await request('/api/auth/login', { method: 'POST', body: { role: 'customer', phone, password: 'secret123' } });
  assert.equal(oldPassword.status, 401);
  const newPassword = await request('/api/auth/login', { method: 'POST', body: { role: 'customer', phone, password: 'brand-new-pass' } });
  assert.equal(newPassword.status, 200);

  const reused = await request('/api/auth/password/reset', {
    method: 'POST', body: { role: 'customer', phone, otpCode: sent.body.devCode, newPassword: 'another-pass-1' },
  });
  assert.equal(reused.status, 400, 'a code works only once');
});
