import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPhone, registerCustomer, registerDriver, requestSignupCode, startServer } from './helpers.js';

test('a rider can register, log in, and fetch their profile', async (context) => {
  const request = await startServer(context);
  const phone = nextPhone();

  const withoutCode = await request('/api/auth/register', {
    method: 'POST',
    body: { role: 'customer', name: 'Asha', phone: `+91 ${phone}`, password: 'secret123' },
  });
  assert.equal(withoutCode.status, 400, 'sign-up needs a verified phone');
  assert.equal(withoutCode.body.error.code, 'INVALID_OTP');

  const otpCode = await requestSignupCode(request, 'customer', phone);
  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: { role: 'customer', name: 'Asha', phone: `+91 ${phone}`, password: 'secret123', otpCode },
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.phone, phone);
  assert.equal(registered.body.user.passwordHash, undefined);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { role: 'customer', phone, password: 'secret123' },
  });
  assert.equal(login.status, 200);

  const me = await request('/api/auth/me', { token: login.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.name, 'Asha');
  assert.equal(me.body.user.role, 'customer');
});

test('login rejects a wrong password and the wrong portal', async (context) => {
  const request = await startServer(context);
  const phone = nextPhone();
  await registerCustomer(request, { phone });

  const wrongPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { role: 'customer', phone, password: 'nope-nope' },
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.body.error.code, 'INVALID_CREDENTIALS');

  const wrongRole = await request('/api/auth/login', {
    method: 'POST',
    body: { role: 'driver', phone, password: 'secret123' },
  });
  assert.equal(wrongRole.status, 401);
});

test('registration validates input and blocks duplicate numbers', async (context) => {
  const request = await startServer(context);
  const phone = nextPhone();

  const badPhone = await request('/api/auth/register', {
    method: 'POST',
    body: { role: 'customer', name: 'Asha', phone: '123', password: 'secret123' },
  });
  assert.equal(badPhone.status, 400);
  assert.equal(badPhone.body.error.code, 'INVALID_PHONE');

  const missingVehicle = await request('/api/auth/register', {
    method: 'POST',
    body: { role: 'driver', name: 'Ravi', phone, password: 'secret123' },
  });
  assert.equal(missingVehicle.status, 400);
  assert.equal(missingVehicle.body.error.code, 'INVALID_VEHICLE_TYPE');

  await registerCustomer(request, { phone });
  const duplicate = await request('/api/auth/register', {
    method: 'POST',
    body: { role: 'customer', name: 'Someone', phone, password: 'secret123' },
  });
  assert.equal(duplicate.status, 409);
});

test('protected routes require a valid token and the right role', async (context) => {
  const request = await startServer(context);

  const anonymous = await request('/api/rides/active');
  assert.equal(anonymous.status, 401);

  const forged = await request('/api/rides/active', { token: 'abc.def' });
  assert.equal(forged.status, 401);

  const customer = await registerCustomer(request);
  const driverOnly = await request('/api/driver/requests', { token: customer.token });
  assert.equal(driverOnly.status, 403);

  const driver = await registerDriver(request);
  const customerOnly = await request('/api/rides', {
    method: 'POST',
    token: driver.token,
    body: {},
  });
  assert.equal(customerOnly.status, 403);
});
