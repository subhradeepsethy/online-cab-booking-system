import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { io as connect } from 'socket.io-client';
import app from '../src/app.js';
import { initRealtime } from '../src/lib/realtime.js';
import { goOnline, registerCustomer, registerDriver, requester, sampleDropoff, samplePickup } from './helpers.js';

// This file runs in its own process, so attaching Socket.IO here doesn't affect other tests.
async function startRealtimeServer(context) {
  const server = http.createServer(app);
  const io = initRealtime(server);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];

  context.after(() => new Promise((resolve) => {
    sockets.forEach((socket) => socket.disconnect());
    io.close(() => resolve());
  }));

  const request = requester(baseUrl);

  function openSocket(token) {
    const socket = connect(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    return socket;
  }

  return { request, openSocket, baseUrl };
}

const once = (socket, event, timeoutMs = 2000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
  socket.once(event, (payload) => {
    clearTimeout(timer);
    resolve(payload);
  });
});

test('sockets reject missing or invalid tokens', async (context) => {
  const { openSocket } = await startRealtimeServer(context);
  const socket = openSocket('not-a-token');
  const error = await once(socket, 'connect_error');
  assert.equal(error.message, 'UNAUTHORIZED');
});

test('drivers hear about new requests and riders hear when a driver accepts', async (context) => {
  const { request, openSocket } = await startRealtimeServer(context);
  const customer = await registerCustomer(request);
  const driver = await registerDriver(request, { vehicleType: 'auto' });

  const driverSocket = openSocket(driver.token);
  const riderSocket = openSocket(customer.token);
  await Promise.all([once(driverSocket, 'connect'), once(riderSocket, 'connect')]);

  // Going online after connecting must move the driver into the request room.
  await goOnline(request, driver);

  const requestsChanged = once(driverSocket, 'requests:changed');
  const created = await request('/api/rides', {
    method: 'POST',
    token: customer.token,
    body: { pickup: samplePickup, dropoff: sampleDropoff, rideType: 'auto' },
  });
  await requestsChanged;

  const rideChanged = once(riderSocket, 'ride:changed');
  await request(`/api/driver/rides/${created.body.ride.id}/accept`, { method: 'POST', token: driver.token });
  const payload = await rideChanged;
  assert.equal(payload.rideId, created.body.ride.id);
});

test('offline drivers do not receive request broadcasts', async (context) => {
  const { request, openSocket } = await startRealtimeServer(context);
  const customer = await registerCustomer(request);
  const driver = await registerDriver(request, { vehicleType: 'bike' });

  const driverSocket = openSocket(driver.token);
  await once(driverSocket, 'connect');

  let received = false;
  driverSocket.on('requests:changed', () => { received = true; });
  await request('/api/rides', {
    method: 'POST',
    token: customer.token,
    body: { pickup: samplePickup, dropoff: sampleDropoff, rideType: 'bike' },
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(received, false);
});
