import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { db } from '../src/lib/store.js';
import { createUser } from '../src/lib/users.js';
import { createAdmin, nextPhone, registerCustomer, registerDriver, startServer } from './helpers.js';

const login = (request, role, phone, password) => request('/api/auth/login', { method: 'POST', body: { role, phone, password } });

test('logging out revokes the token on the server', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);

  assert.equal((await request('/api/auth/me', { token: customer.token })).status, 200);
  assert.equal((await request('/api/auth/logout', { method: 'POST', token: customer.token })).status, 204);
  assert.equal((await request('/api/auth/me', { token: customer.token })).status, 401);
});

test('blocking revokes existing tokens, even after the user is unblocked', async (context) => {
  const request = await startServer(context);
  const admin = await createAdmin();
  const customer = await registerCustomer(request);

  await request(`/api/admin/users/${customer.user.id}`, { method: 'PATCH', token: admin.token, body: { blocked: true } });
  await request(`/api/admin/users/${customer.user.id}`, { method: 'PATCH', token: admin.token, body: { blocked: false } });

  assert.equal((await request('/api/auth/me', { token: customer.token })).status, 401, 'old token must stay revoked');
  const fresh = await login(request, 'customer', customer.user.phone, 'secret123');
  assert.equal(fresh.status, 200);

  const audit = await request('/api/admin/audit-log', { token: admin.token });
  assert.deepEqual(audit.body.entries.slice(0, 2).map((entry) => entry.action), ['user.unblock', 'user.block']);
  assert.equal(audit.body.entries[0].adminId, admin.user.id);
});

test('an account locks after repeated wrong passwords', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await login(request, 'customer', customer.user.phone, 'wrong-password')).status, 401);
  }
  const locked = await login(request, 'customer', customer.user.phone, 'secret123');
  assert.equal(locked.status, 429, 'even the right password is refused while locked');
  assert.equal(locked.body.error.code, 'TOO_MANY_ATTEMPTS');
});

test('passwords use strong scrypt and legacy hashes are upgraded on login', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const user = db.users.find((candidate) => candidate.id === customer.user.id);
  assert.match(user.passwordHash, /^scrypt\$131072\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);

  // Simulate an account created with the old hash format.
  const salt = crypto.randomBytes(16).toString('hex');
  user.passwordHash = `${salt}:${crypto.scryptSync('secret123', salt, 64).toString('hex')}`;

  assert.equal((await login(request, 'customer', customer.user.phone, 'secret123')).status, 200);
  assert.match(user.passwordHash, /^scrypt\$131072\$/);
  assert.equal((await login(request, 'customer', customer.user.phone, 'secret123')).status, 200);
});

test('password and role rules', async (context) => {
  const request = await startServer(context);

  const short = await request('/api/auth/register', {
    method: 'POST', body: { role: 'customer', name: 'Asha', phone: nextPhone(), password: 'short1' },
  });
  assert.equal(short.body.error.code, 'INVALID_PASSWORD');

  const selfAdmin = await request('/api/auth/register', {
    method: 'POST', body: { role: 'admin', name: 'Mallory', phone: nextPhone(), password: 'long-enough-password' },
  });
  assert.equal(selfAdmin.status, 400, 'admins cannot sign themselves up');

  await assert.rejects(
    createUser({ role: 'admin', name: 'Weak Admin', phone: nextPhone(), password: 'only9char' }, { allowAdmin: true }),
    /12-128 characters/,
  );
});

test('drivers only get the rider phone number while the trip is active', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const driver = await registerDriver(request, { vehicleType: 'mini' });
  await request('/api/driver/availability', { method: 'PATCH', token: driver.token, body: { isOnline: true } });

  const created = await request('/api/rides', {
    method: 'POST',
    token: customer.token,
    body: { pickup: { address: 'A Street' }, dropoff: { address: 'B Street' }, rideType: 'mini' },
  });
  const rideId = created.body.ride.id;
  const accepted = await request(`/api/driver/rides/${rideId}/accept`, { method: 'POST', token: driver.token });
  assert.equal(accepted.body.ride.customer.phone, customer.user.phone);

  const { body } = await request('/api/rides/active', { token: customer.token });
  await request(`/api/driver/rides/${rideId}/start`, { method: 'POST', token: driver.token, body: { otp: body.ride.otp } });
  await request(`/api/driver/rides/${rideId}/complete`, { method: 'POST', token: driver.token });

  const driverHistory = await request('/api/rides', { token: driver.token });
  assert.equal(driverHistory.body.rides[0].customer.phone, undefined);
  const riderHistory = await request('/api/rides', { token: customer.token });
  assert.equal(riderHistory.body.rides[0].driver.phone, undefined);
});
