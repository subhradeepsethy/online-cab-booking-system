import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer } from './helpers.js';

test('GET /api/health reports a healthy API', async (context) => {
  const request = await startServer(context);
  const { status, body } = await request('/api/health');

  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'cab-system-api');
  assert.equal(typeof body.timestamp, 'string');
});

test('GET / points visitors to the web app instead of returning 404', async (context) => {
  const request = await startServer(context);
  const { status, body } = await request('/');

  assert.equal(status, 200);
  assert.match(body.message, /API server/);
});

test('unknown routes return a structured 404 response', async (context) => {
  const request = await startServer(context);
  const { status, body } = await request('/api/missing');

  assert.equal(status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
});
