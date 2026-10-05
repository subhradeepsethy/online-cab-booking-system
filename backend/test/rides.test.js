import assert from 'node:assert/strict';
import test from 'node:test';
import { goOnline as setOnline, registerCustomer, registerDriver, sampleDropoff, samplePickup, startServer } from './helpers.js';

async function goOnline(request, driver) {
  const response = await setOnline(request, driver);
  assert.equal(response.status, 200);
}

async function requestRide(request, customer, overrides = {}) {
  return request('/api/rides', {
    method: 'POST',
    token: customer.token,
    body: { pickup: samplePickup, dropoff: sampleDropoff, rideType: 'sedan', paymentMethod: 'upi', ...overrides },
  });
}

test('fare estimates are returned for every ride type', async (context) => {
  const request = await startServer(context);
  const { status, body } = await request('/api/rides/estimate', {
    method: 'POST',
    body: { pickup: samplePickup, dropoff: sampleDropoff, distanceKm: 10, durationMin: 25 },
  });

  assert.equal(status, 200);
  assert.equal(body.distanceKm, 10);
  assert.deepEqual(body.estimates.map((estimate) => estimate.id), ['bike', 'auto', 'mini', 'sedan', 'suv']);
  const sedan = body.estimates.find((estimate) => estimate.id === 'sedan');
  assert.equal(sedan.fare, 70 + 16 * 10 + 2 * 25);
});

test('full trip: request, accept, arrive, OTP start, complete, rate', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const driver = await registerDriver(request);
  await goOnline(request, driver);

  const created = await requestRide(request, customer);
  assert.equal(created.status, 201);
  assert.equal(created.body.ride.status, 'requested');
  const rideId = created.body.ride.id;

  const duplicate = await requestRide(request, customer);
  assert.equal(duplicate.status, 409);

  const requests = await request('/api/driver/requests', { token: driver.token });
  const offer = requests.body.requests.find((ride) => ride.id === rideId);
  assert.ok(offer, 'online driver with matching vehicle sees the request');
  assert.equal(offer.otp, undefined, 'drivers never see the OTP');

  const accepted = await request(`/api/driver/rides/${rideId}/accept`, { method: 'POST', token: driver.token });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.ride.status, 'accepted');
  assert.equal(accepted.body.ride.otp, undefined);

  const riderView = await request('/api/rides/active', { token: customer.token });
  assert.equal(riderView.body.ride.status, 'accepted');
  assert.equal(riderView.body.ride.driver.vehicleNumber, 'OD 02 CD 5678');
  const { otp } = riderView.body.ride;
  assert.match(otp, /^\d{4}$/);

  const arrived = await request(`/api/driver/rides/${rideId}/arrive`, { method: 'POST', token: driver.token });
  assert.equal(arrived.body.ride.status, 'arrived');

  const wrongOtp = await request(`/api/driver/rides/${rideId}/start`, {
    method: 'POST',
    token: driver.token,
    body: { otp: otp === '1234' ? '4321' : '1234' },
  });
  assert.equal(wrongOtp.status, 400);
  assert.equal(wrongOtp.body.error.code, 'INVALID_OTP');

  const started = await request(`/api/driver/rides/${rideId}/start`, { method: 'POST', token: driver.token, body: { otp } });
  assert.equal(started.body.ride.status, 'in_progress');

  const lateCancel = await request(`/api/rides/${rideId}/cancel`, { method: 'POST', token: customer.token });
  assert.equal(lateCancel.status, 409);

  const completed = await request(`/api/driver/rides/${rideId}/complete`, { method: 'POST', token: driver.token });
  assert.equal(completed.body.ride.status, 'completed');

  const rated = await request(`/api/rides/${rideId}/rate`, { method: 'POST', token: customer.token, body: { rating: 5 } });
  assert.equal(rated.status, 200);
  assert.equal(rated.body.ride.rating, 5);

  const summary = await request('/api/driver/summary', { token: driver.token });
  assert.equal(summary.body.summary.todayTrips, 1);
  assert.equal(summary.body.summary.todayEarnings, completed.body.ride.fare);
  assert.equal(summary.body.summary.rating, 5);

  const history = await request('/api/rides', { token: customer.token });
  assert.equal(history.body.rides[0].id, rideId);
});

test('drivers only see requests for their vehicle type while online', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const driver = await registerDriver(request, { vehicleType: 'auto' });

  const created = await requestRide(request, customer, { rideType: 'auto' });
  const rideId = created.body.ride.id;

  const offline = await request('/api/driver/requests', { token: driver.token });
  assert.equal(offline.body.requests.length, 0);

  await goOnline(request, driver);
  const online = await request('/api/driver/requests', { token: driver.token });
  assert.ok(online.body.requests.some((ride) => ride.id === rideId));

  const sedanDriver = await registerDriver(request, { vehicleType: 'sedan' });
  await goOnline(request, sedanDriver);
  const mismatch = await request(`/api/driver/rides/${rideId}/accept`, { method: 'POST', token: sedanDriver.token });
  assert.equal(mismatch.status, 409);
});

test('a ride can only be accepted by one driver', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const first = await registerDriver(request, { vehicleType: 'suv' });
  const second = await registerDriver(request, { vehicleType: 'suv' });
  await goOnline(request, first);
  await goOnline(request, second);

  const created = await requestRide(request, customer, { rideType: 'suv' });
  const rideId = created.body.ride.id;

  const winner = await request(`/api/driver/rides/${rideId}/accept`, { method: 'POST', token: first.token });
  const loser = await request(`/api/driver/rides/${rideId}/accept`, { method: 'POST', token: second.token });
  assert.equal(winner.status, 200);
  assert.equal(loser.status, 409);

  const otherDriverView = await request(`/api/rides/${rideId}`, { token: second.token });
  assert.equal(otherDriverView.status, 404, 'drivers cannot read rides that are not theirs');
});

test('a driver cancelling sends the request back to other drivers', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const first = await registerDriver(request, { vehicleType: 'bike' });
  const second = await registerDriver(request, { vehicleType: 'bike' });
  await goOnline(request, first);
  await goOnline(request, second);

  const created = await requestRide(request, customer, { rideType: 'bike' });
  const rideId = created.body.ride.id;
  await request(`/api/driver/rides/${rideId}/accept`, { method: 'POST', token: first.token });

  const cancelled = await request(`/api/rides/${rideId}/cancel`, { method: 'POST', token: first.token });
  assert.equal(cancelled.status, 200);

  const riderView = await request('/api/rides/active', { token: customer.token });
  assert.equal(riderView.body.ride.status, 'requested');
  assert.equal(riderView.body.ride.driver, null);

  const firstRequests = await request('/api/driver/requests', { token: first.token });
  assert.equal(firstRequests.body.requests.some((ride) => ride.id === rideId), false);
  const secondRequests = await request('/api/driver/requests', { token: second.token });
  assert.equal(secondRequests.body.requests.some((ride) => ride.id === rideId), true);
});

test('a rider can cancel before the trip starts', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);

  const created = await requestRide(request, customer, { rideType: 'mini' });
  const cancelled = await request(`/api/rides/${created.body.ride.id}/cancel`, { method: 'POST', token: customer.token });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.ride.status, 'cancelled');

  const active = await request('/api/rides/active', { token: customer.token });
  assert.equal(active.body.ride, null);
});

test('ride requests are validated', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);

  const missingDropoff = await requestRide(request, customer, { dropoff: { address: '' } });
  assert.equal(missingDropoff.status, 400);

  const badType = await requestRide(request, customer, { rideType: 'helicopter' });
  assert.equal(badType.status, 400);
  assert.equal(badType.body.error.code, 'INVALID_RIDE_TYPE');
});
