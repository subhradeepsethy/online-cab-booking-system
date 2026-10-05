import assert from 'node:assert/strict';
import test from 'node:test';
import app from '../src/app.js';
import { goOnline, registerCustomer, registerDriver, sampleDropoff, samplePickup, startServer, tinyPng } from './helpers.js';

async function rawFetch(context, path, init) {
  const server = app.listen(0);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, init);
}

test('security headers are set and debug details are hidden', async (context) => {
  const response = await rawFetch(context, '/api/health');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.ok(response.headers.get('strict-transport-security'));
});

test('malformed and oversized bodies get generic errors', async (context) => {
  const bad = await rawFetch(context, '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"role": ',
  });
  const badBody = await bad.json();
  assert.equal(bad.status, 400);
  assert.equal(badBody.error.code, 'INVALID_JSON');
  assert.doesNotMatch(badBody.error.message, /Unexpected|position|token/i, 'parser internals are not leaked');

  const big = await rawFetch(context, '/api/rides/estimate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(200_000) }),
  });
  assert.equal(big.status, 413);
});

test('large upload bodies are refused before authentication', async (context) => {
  const response = await rawFetch(context, '/api/driver/documents/license', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataBase64: 'A'.repeat(500_000) }),
  });
  assert.equal(response.status, 401);
});

test('prototype names are rejected instead of crashing or polluting objects', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const driver = await registerDriver(request, { approve: false });

  for (const rideType of ['constructor', '__proto__', 'toString']) {
    const response = await request('/api/rides', { method: 'POST', token: customer.token, body: { pickup: samplePickup, dropoff: sampleDropoff, rideType } });
    assert.equal(response.status, 400, `rideType ${rideType}`);
  }

  const promo = await request('/api/rides/estimate', { method: 'POST', body: { pickup: samplePickup, dropoff: sampleDropoff, promoCode: '__proto__' } });
  assert.equal(promo.status, 200);
  assert.equal(promo.body.promo.valid, false);

  const mime = await request('/api/driver/documents/license', { method: 'PUT', token: driver.token, body: { mimeType: 'toString', dataBase64: tinyPng } });
  assert.equal(mime.status, 400);

  const docType = await request('/api/driver/documents/constructor', { method: 'PUT', token: driver.token, body: { mimeType: 'image/png', dataBase64: tinyPng } });
  assert.equal(docType.status, 400);
  assert.equal({}.uploadedAt, undefined, 'Object.prototype untouched');
});

test('the server does not trust a client-claimed trip distance', async (context) => {
  const request = await startServer(context);

  // About 4.8 km apart in a straight line, so 0.5 km is impossible.
  const cheap = await request('/api/rides/estimate', {
    method: 'POST', body: { pickup: samplePickup, dropoff: sampleDropoff, distanceKm: 0.5, durationMin: 1 },
  });
  assert.ok(cheap.body.distanceKm >= 4.8, `got ${cheap.body.distanceKm} km`);

  const noCoords = await request('/api/rides/estimate', {
    method: 'POST', body: { pickup: { address: 'Somewhere' }, dropoff: { address: 'Far away' }, distanceKm: 0.1 },
  });
  assert.notEqual(noCoords.body.distanceKm, 0.1, 'claims without coordinates are ignored');
});

test('user text is cleaned of control characters', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request, { name: '  Asha\u0000‮  Rider\n' });
  assert.equal(customer.user.name, 'Asha Rider');

  const odia = await registerCustomer(request, { name: 'ଶ୍‍ରୀ ଦାସ' });
  assert.equal(odia.user.name, 'ଶ୍‍ରୀ ଦାସ', 'zero-width joiner kept for Indic scripts');
});

test('the ride OTP locks after five wrong attempts, and arrival fees need GPS', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const driver = await registerDriver(request, { vehicleType: 'auto' });
  await goOnline(request, driver);

  const created = await request('/api/rides', { method: 'POST', token: customer.token, body: { pickup: samplePickup, dropoff: sampleDropoff, rideType: 'auto' } });
  const rideId = created.body.ride.id;
  await request(`/api/driver/rides/${rideId}/accept`, { method: 'POST', token: driver.token });
  // Driver taps "arrived" without any GPS fix: no arrival fee.
  await request(`/api/driver/rides/${rideId}/arrive`, { method: 'POST', token: driver.token });
  const active = await request('/api/rides/active', { token: customer.token });
  assert.equal(active.body.ride.cancellationFeeIfCancelledNow, 0);

  const wrong = active.body.ride.otp === '0000' ? '1111' : '0000';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request(`/api/driver/rides/${rideId}/start`, { method: 'POST', token: driver.token, body: { otp: wrong } });
    assert.equal(response.status, 400);
  }
  const locked = await request(`/api/driver/rides/${rideId}/start`, { method: 'POST', token: driver.token, body: { otp: active.body.ride.otp } });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error.code, 'OTP_LOCKED');
});
