import { Router } from 'express';
import { cancellationPolicy, paymentMethods, promoCodes, rideTypes } from '../lib/fare.js';
import {
  cancelRide,
  createRide,
  findActiveRide,
  getOwnRide,
  listRidesFor,
  listUpcomingRides,
  quoteTrip,
  rateRide,
  serializeRide,
} from '../lib/rides.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { bookingLimiter } from '../middleware/rateLimits.js';

const ridesRouter = Router();

ridesRouter.get('/types', (_request, response) => {
  response.json({
    rideTypes: Object.entries(rideTypes).map(([id, type]) => ({ id, ...type })),
    paymentMethods,
    promos: Object.entries(promoCodes).map(([code, promo]) => ({ code, description: promo.description })),
    cancellationPolicy,
  });
});

ridesRouter.post('/estimate', optionalAuth, (request, response) => {
  const customer = request.user?.role === 'customer' ? request.user : null;
  const { trip, estimates, promo } = quoteTrip(customer, request.body ?? {});
  response.json({ ...trip, estimates, promo });
});

ridesRouter.post('/', requireAuth('customer'), bookingLimiter, (request, response) => {
  const ride = createRide(request.user, request.body ?? {});
  response.status(201).json({ ride: serializeRide(ride, request.user) });
});

ridesRouter.get('/active', requireAuth(), (request, response) => {
  const ride = findActiveRide(request.user);
  response.json({ ride: ride ? serializeRide(ride, request.user) : null });
});

ridesRouter.get('/upcoming', requireAuth('customer'), (request, response) => {
  response.json({ rides: listUpcomingRides(request.user).map((ride) => serializeRide(ride, request.user)) });
});

ridesRouter.get('/', requireAuth(), (request, response) => {
  response.json({ rides: listRidesFor(request.user).map((ride) => serializeRide(ride, request.user)) });
});

ridesRouter.get('/:id', requireAuth(), (request, response) => {
  response.json({ ride: serializeRide(getOwnRide(request.user, request.params.id), request.user) });
});

ridesRouter.post('/:id/cancel', requireAuth('customer', 'driver'), (request, response) => {
  const ride = cancelRide(request.user, request.params.id, request.body?.reason);
  response.json({ ride: request.user.role === 'customer' ? serializeRide(ride, request.user) : null });
});

ridesRouter.post('/:id/rate', requireAuth('customer'), (request, response) => {
  const ride = rateRide(request.user, request.params.id, request.body?.rating);
  response.json({ ride: serializeRide(ride, request.user) });
});

export default ridesRouter;
