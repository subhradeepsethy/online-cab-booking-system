import express, { Router } from 'express';
import { readDriverDocument, uploadDriverDocument } from '../lib/driverDocuments.js';
import {
  acceptRide,
  completeRide,
  declineRide,
  driverSummary,
  listOpenRequests,
  markArrived,
  rateRider,
  serializeRide,
  setDriverLocation,
  setDriverOnline,
  startRide,
} from '../lib/rides.js';
import { publicUser } from '../lib/users.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimits.js';

const driverRouter = Router();

driverRouter.use(requireAuth('driver'));

driverRouter.get('/summary', (request, response) => {
  response.json({ summary: driverSummary(request.user) });
});

driverRouter.patch('/availability', (request, response) => {
  setDriverOnline(request.user, request.body?.isOnline);
  response.json({ user: publicUser(request.user) });
});

driverRouter.put('/location', (request, response) => {
  setDriverLocation(request.user, request.body);
  response.status(204).end();
});

// The only route with a large body limit, and it is reached only after authentication.
driverRouter.put('/documents/:type', uploadLimiter, express.json({ limit: '5mb' }), (request, response) => {
  uploadDriverDocument(request.user, request.params.type, request.body);
  response.json({ user: publicUser(request.user) });
});

driverRouter.get('/documents/:type/file', (request, response) => {
  const { buffer, mimeType } = readDriverDocument(request.user, request.params.type);
  response.set('Cache-Control', 'private, no-store').type(mimeType).send(buffer);
});

driverRouter.get('/requests', (request, response) => {
  response.json({ requests: listOpenRequests(request.user) });
});

driverRouter.post('/rides/:id/accept', (request, response) => {
  response.json({ ride: serializeRide(acceptRide(request.user, request.params.id), request.user) });
});

driverRouter.post('/rides/:id/decline', (request, response) => {
  declineRide(request.user, request.params.id);
  response.status(204).end();
});

driverRouter.post('/rides/:id/arrive', (request, response) => {
  response.json({ ride: serializeRide(markArrived(request.user, request.params.id), request.user) });
});

driverRouter.post('/rides/:id/start', (request, response) => {
  response.json({ ride: serializeRide(startRide(request.user, request.params.id, request.body?.otp), request.user) });
});

driverRouter.post('/rides/:id/complete', (request, response) => {
  response.json({ ride: serializeRide(completeRide(request.user, request.params.id), request.user) });
});

driverRouter.post('/rides/:id/rate', (request, response) => {
  response.json({ ride: serializeRide(rateRider(request.user, request.params.id, request.body?.rating), request.user) });
});

export default driverRouter;
