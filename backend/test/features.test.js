import assert from 'node:assert/strict';
import test from 'node:test';
import { runRideMaintenance } from '../src/lib/rides.js';
import {
  createAdmin,
  goOnline,
  registerCustomer,
  registerDriver,
  sampleDropoff,
  samplePickup,
  startServer,
  tinyPng,
  uploadAllDocuments,
} from './helpers.js';

const tripBody = (overrides = {}) => ({ pickup: samplePickup, dropoff: sampleDropoff, rideType: 'sedan', paymentMethod: 'cash', ...overrides });

async function completeTrip(request, customer, driver, overrides = {}) {
  const created = await request('/api/rides', { method: 'POST', token: customer.token, body: tripBody(overrides) });
  const rideId = created.body.ride.id;
  await request(`/api/driver/rides/${rideId}/accept`, { method: 'POST', token: driver.token });
  const { body } = await request('/api/rides/active', { token: customer.token });
  await request(`/api/driver/rides/${rideId}/start`, { method: 'POST', token: driver.token, body: { otp: body.ride.otp } });
  const completed = await request(`/api/driver/rides/${rideId}/complete`, { method: 'POST', token: driver.token });
  return completed.body.ride;
}

test('new drivers need documents and admin approval before going online', async (context) => {
  const request = await startServer(context);
  const driver = await registerDriver(request, { approve: false });
  const admin = await createAdmin();
  assert.equal(driver.user.driver.approvalStatus, 'pending');

  const blockedOnline = await goOnline(request, driver);
  assert.equal(blockedOnline.status, 403);
  assert.equal(blockedOnline.body.error.code, 'DRIVER_NOT_APPROVED');

  const tooEarly = await request(`/api/admin/users/${driver.user.id}`, {
    method: 'PATCH', token: admin.token, body: { approvalStatus: 'approved' },
  });
  assert.equal(tooEarly.status, 409);
  assert.equal(tooEarly.body.error.code, 'MISSING_DOCUMENTS');

  await uploadAllDocuments(request, driver);
  const doc = await request(`/api/admin/users/${driver.user.id}/documents/license`, { token: admin.token });
  assert.equal(doc.status, 200);

  const rejectWithoutNote = await request(`/api/admin/users/${driver.user.id}`, {
    method: 'PATCH', token: admin.token, body: { approvalStatus: 'rejected' },
  });
  assert.equal(rejectWithoutNote.status, 400);

  const approved = await request(`/api/admin/users/${driver.user.id}`, {
    method: 'PATCH', token: admin.token, body: { approvalStatus: 'approved' },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.user.driver.approvalStatus, 'approved');
  assert.equal((await goOnline(request, driver)).status, 200);
});

test('document uploads reject files whose content does not match the type', async (context) => {
  const request = await startServer(context);
  const driver = await registerDriver(request, { approve: false });

  const fake = await request('/api/driver/documents/license', {
    method: 'PUT',
    token: driver.token,
    body: { fileName: 'x.png', mimeType: 'image/png', dataBase64: Buffer.from('not a png').toString('base64') },
  });
  assert.equal(fake.status, 400);
  assert.equal(fake.body.error.code, 'INVALID_FILE');

  const badType = await request('/api/driver/documents/license', {
    method: 'PUT', token: driver.token, body: { mimeType: 'text/html', dataBase64: tinyPng },
  });
  assert.equal(badType.status, 400);

  const ok = await request('/api/driver/documents/license', {
    method: 'PUT', token: driver.token, body: { fileName: 'licence.png', mimeType: 'image/png', dataBase64: tinyPng },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.driver.documents.license.uploaded, true);

  const own = await request('/api/driver/documents/license/file', { token: driver.token });
  assert.equal(own.status, 200);
});

test('admins can block users, which stops login and API access', async (context) => {
  const request = await startServer(context);
  const admin = await createAdmin();
  const customer = await registerCustomer(request);

  const nonAdmin = await request('/api/admin/overview', { token: customer.token });
  assert.equal(nonAdmin.status, 403);

  const blocked = await request(`/api/admin/users/${customer.user.id}`, { method: 'PATCH', token: admin.token, body: { blocked: true } });
  assert.equal(blocked.body.user.blocked, true);

  // Blocking revokes the session the user already had.
  const api = await request('/api/rides/active', { token: customer.token });
  assert.equal(api.status, 401);

  const login = await request('/api/auth/login', {
    method: 'POST', body: { role: 'customer', phone: customer.user.phone, password: 'secret123' },
  });
  assert.equal(login.status, 403);
  assert.equal(login.body.error.code, 'ACCOUNT_BLOCKED');

  await request(`/api/admin/users/${customer.user.id}`, { method: 'PATCH', token: admin.token, body: { blocked: false } });
  const again = await request('/api/auth/login', {
    method: 'POST', body: { role: 'customer', phone: customer.user.phone, password: 'secret123' },
  });
  assert.equal((await request('/api/rides/active', { token: again.body.token })).status, 200);
});

test('admin overview, ride list and force-cancel', async (context) => {
  const request = await startServer(context);
  const admin = await createAdmin();
  const customer = await registerCustomer(request);
  const driver = await registerDriver(request);
  await goOnline(request, driver);
  await completeTrip(request, customer, driver);

  const overview = await request('/api/admin/overview', { token: admin.token });
  assert.equal(overview.status, 200);
  assert.ok(overview.body.counts.completedRides >= 1);
  assert.equal(overview.body.daily.length, 7);
  assert.ok(overview.body.revenue.today > 0);

  const created = await request('/api/rides', { method: 'POST', token: customer.token, body: tripBody() });
  const active = await request('/api/admin/rides?status=active', { token: admin.token });
  assert.ok(active.body.rides.some((ride) => ride.id === created.body.ride.id));
  assert.equal(active.body.rides[0].otp, undefined, 'admins never see ride OTPs');

  const cancelled = await request(`/api/admin/rides/${created.body.ride.id}/cancel`, { method: 'POST', token: admin.token, body: { reason: 'Test' } });
  assert.equal(cancelled.body.ride.status, 'cancelled');
  assert.equal(cancelled.body.ride.cancelledBy, 'admin');

  const drivers = await request('/api/admin/users?role=driver', { token: admin.token });
  const listed = drivers.body.users.find((user) => user.id === driver.user.id);
  assert.equal(listed.stats.trips, 1);
});

test('promo codes discount the fare but drivers earn the full amount', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const driver = await registerDriver(request);
  await goOnline(request, driver);

  const quote = await request('/api/rides/estimate', {
    method: 'POST', token: customer.token, body: { ...tripBody(), distanceKm: 10, durationMin: 20, promoCode: 'welcome50' },
  });
  const sedan = quote.body.estimates.find((estimate) => estimate.id === 'sedan');
  assert.equal(quote.body.promo.valid, true);
  assert.equal(sedan.discount, 100, '50% capped at ₹100');
  assert.equal(sedan.fare, sedan.subtotal - 100);

  const invalid = await request('/api/rides', { method: 'POST', token: customer.token, body: tripBody({ promoCode: 'NOPE' }) });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_PROMO');

  const ride = await completeTrip(request, customer, driver, { promoCode: 'WELCOME50', distanceKm: 10, durationMin: 20 });
  assert.equal(ride.discount, 100);
  assert.equal(ride.driverEarnings, ride.subtotal);

  const second = await request('/api/rides/estimate', {
    method: 'POST', token: customer.token, body: { ...tripBody(), promoCode: 'WELCOME50' },
  });
  assert.equal(second.body.promo.valid, false, 'first-ride promo cannot be reused');

  const flat = await request('/api/rides/estimate', {
    method: 'POST', body: { ...tripBody(), distanceKm: 1, durationMin: 3, promoCode: 'FLAT30' },
  });
  const bike = flat.body.estimates.find((estimate) => estimate.id === 'bike');
  assert.match(bike.promoError, /at least/);
});

test('scheduled rides wait, then are released to drivers before pickup time', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const driver = await registerDriver(request, { vehicleType: 'suv' });
  await goOnline(request, driver);

  const tooSoon = await request('/api/rides', {
    method: 'POST', token: customer.token, body: tripBody({ rideType: 'suv', scheduledFor: new Date(Date.now() + 5 * 60000).toISOString() }),
  });
  assert.equal(tooSoon.status, 400);

  const scheduledFor = new Date(Date.now() + 60 * 60000).toISOString();
  const created = await request('/api/rides', {
    method: 'POST', token: customer.token, body: tripBody({ rideType: 'suv', scheduledFor }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.ride.status, 'scheduled');

  const upcoming = await request('/api/rides/upcoming', { token: customer.token });
  assert.equal(upcoming.body.rides.length, 1);
  const hidden = await request('/api/driver/requests', { token: driver.token });
  assert.equal(hidden.body.requests.some((ride) => ride.id === created.body.ride.id), false);

  // Jump to 10 minutes before pickup: the ride should now be offered to drivers.
  runRideMaintenance(Date.parse(scheduledFor) - 10 * 60000);
  const visible = await request('/api/driver/requests', { token: driver.token });
  assert.equal(visible.body.requests.some((ride) => ride.id === created.body.ride.id), true);
});

test('late cancellation by the rider pays the driver a fee', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const driver = await registerDriver(request, { vehicleType: 'auto' });
  await goOnline(request, driver);

  const created = await request('/api/rides', { method: 'POST', token: customer.token, body: tripBody({ rideType: 'auto' }) });
  const rideId = created.body.ride.id;
  assert.equal(created.body.ride.cancellationFeeIfCancelledNow, 0);

  await request(`/api/driver/rides/${rideId}/accept`, { method: 'POST', token: driver.token });
  // The arrival fee needs GPS to place the driver at the pickup.
  await request('/api/driver/location', { method: 'PUT', token: driver.token, body: { lat: samplePickup.lat + 0.001, lng: samplePickup.lng } });
  await request(`/api/driver/rides/${rideId}/arrive`, { method: 'POST', token: driver.token });

  const active = await request('/api/rides/active', { token: customer.token });
  assert.equal(active.body.ride.cancellationFeeIfCancelledNow, 50);

  const cancelled = await request(`/api/rides/${rideId}/cancel`, { method: 'POST', token: customer.token });
  assert.equal(cancelled.body.ride.cancellationFee, 50);

  const summary = await request('/api/driver/summary', { token: driver.token });
  assert.equal(summary.body.summary.todayEarnings, 50);
  assert.equal(summary.body.summary.daily.at(-1).earnings, 50);
});

test('drivers can rate riders once after the trip', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);
  const driver = await registerDriver(request, { vehicleType: 'mini' });
  await goOnline(request, driver);
  const ride = await completeTrip(request, customer, driver, { rideType: 'mini' });

  const rated = await request(`/api/driver/rides/${ride.id}/rate`, { method: 'POST', token: driver.token, body: { rating: 4 } });
  assert.equal(rated.body.ride.riderRating, 4);
  const again = await request(`/api/driver/rides/${ride.id}/rate`, { method: 'POST', token: driver.token, body: { rating: 5 } });
  assert.equal(again.status, 409);

  const me = await request('/api/auth/me', { token: customer.token });
  assert.equal(me.body.user.rider.rating, 4);
});

test('riders can save Home and Work places', async (context) => {
  const request = await startServer(context);
  const customer = await registerCustomer(request);

  const saved = await request('/api/me/places/home', { method: 'PUT', token: customer.token, body: samplePickup });
  assert.equal(saved.body.user.rider.savedPlaces.home.address, samplePickup.address);

  const badLabel = await request('/api/me/places/gym', { method: 'PUT', token: customer.token, body: samplePickup });
  assert.equal(badLabel.status, 400);

  const removed = await request('/api/me/places/home', { method: 'DELETE', token: customer.token });
  assert.equal(removed.body.user.rider.savedPlaces.home, undefined);
});
