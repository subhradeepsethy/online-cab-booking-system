import { Router } from 'express';
import { adminAuditLog, adminDocumentFile, adminListRides, adminListUsers, adminOverview, adminUpdateUser } from '../lib/admin.js';
import { badRequest } from '../lib/httpError.js';
import { cancelRide, serializeRide } from '../lib/rides.js';
import { recordAudit } from '../lib/store.js';
import { requireAuth } from '../middleware/auth.js';

const adminRouter = Router();

// Every admin route requires a valid, unrevoked admin token; the role comes from the database,
// never from anything the client sends.
adminRouter.use(requireAuth('admin'));

adminRouter.get('/overview', (_request, response) => {
  response.json(adminOverview());
});

adminRouter.get('/rides', (request, response) => {
  response.json({ rides: adminListRides(request.query) });
});

adminRouter.post('/rides/:id/cancel', (request, response) => {
  const ride = cancelRide(request.user, request.params.id, request.body?.reason);
  recordAudit(request.user, 'ride.cancel', { rideId: ride.id, customerName: ride.customerName });
  response.json({ ride: serializeRide(ride, request.user) });
});

adminRouter.get('/users', (request, response) => {
  if (!['customer', 'driver'].includes(request.query.role)) {
    throw badRequest('INVALID_ROLE', 'role must be customer or driver.');
  }
  response.json({ users: adminListUsers(request.query) });
});

adminRouter.patch('/users/:id', (request, response) => {
  response.json({ user: adminUpdateUser(request.user, request.params.id, request.body ?? {}) });
});

adminRouter.get('/users/:id/documents/:type', (request, response) => {
  const { buffer, mimeType } = adminDocumentFile(request.params.id, request.params.type);
  response.set('Cache-Control', 'private, no-store').type(mimeType).send(buffer);
});

adminRouter.get('/audit-log', (_request, response) => {
  response.json({ entries: adminAuditLog() });
});

export default adminRouter;
