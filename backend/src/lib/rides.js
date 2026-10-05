import crypto from 'node:crypto';
import {
  calculateFare,
  cancellationFee,
  evaluatePromo,
  isValidCoordinate,
  normalizePromoCode,
  paymentMethods,
  resolveTrip,
  rideTypes,
  straightLineKm,
} from './fare.js';
import { badRequest, conflict, HttpError, notFound } from './httpError.js';
import { notifyRideChanged, syncDriverRooms } from './realtime.js';
import { db, save } from './store.js';
import { cleanText, driverApprovalStatus, driverRating, findUserById, riderProfile, riderRating } from './users.js';

export const activeStatuses = ['requested', 'accepted', 'arrived', 'in_progress'];

const minute = 60 * 1000;
// Requests nobody accepts within this window are cancelled so riders aren't left waiting forever.
const requestTimeoutMs = 10 * minute;
// Scheduled rides are offered to drivers this long before the pickup time.
const dispatchLeadMs = 15 * minute;
const minScheduleLeadMs = 20 * minute;
const maxScheduleAheadMs = 7 * 24 * 60 * minute;
const maxUpcomingRides = 3;
const maxOtpAttempts = 5;

const isActive = (ride) => activeStatuses.includes(ride.status);
const ownerKey = (user) => (user.role === 'driver' ? 'driverId' : 'customerId');

export function parsePlace(value, label) {
  const address = cleanText(value?.address, 300);
  if (!address || address.length > 300) {
    throw badRequest('INVALID_LOCATION', `Enter a ${label} location.`);
  }

  const place = { address };
  const point = { lat: Number(value.lat), lng: Number(value.lng) };
  if (value.lat != null && value.lng != null && isValidCoordinate(point)) {
    place.lat = point.lat;
    place.lng = point.lng;
  }
  return place;
}

function cancel(ride, by, reason, fee = 0) {
  ride.status = 'cancelled';
  ride.cancelledAt = new Date().toISOString();
  ride.cancelledBy = by;
  ride.cancelReason = reason;
  ride.cancellationFee = fee;
}

// Time-based transitions: expire unanswered requests and release scheduled rides to drivers.
// Runs on reads and on a server timer, so it is safe to call often.
export function runRideMaintenance(now = Date.now()) {
  const changed = [];

  for (const ride of db.rides) {
    if (ride.status === 'requested' && now - Date.parse(ride.requestedAt) > requestTimeoutMs) {
      cancel(ride, 'system', 'No drivers accepted the request in time.');
      changed.push(ride);
    }

    if (ride.status === 'scheduled' && Date.parse(ride.scheduledFor) - dispatchLeadMs <= now) {
      const busy = db.rides.some((other) => other.customerId === ride.customerId && isActive(other));
      if (!busy) {
        ride.status = 'requested';
        ride.requestedAt = new Date(now).toISOString();
        changed.push(ride);
      } else if (now > Date.parse(ride.scheduledFor) + dispatchLeadMs) {
        cancel(ride, 'system', 'You had another ride in progress at the scheduled time.');
        changed.push(ride);
      }
    }
  }

  if (changed.length > 0) {
    save(...changed);
    changed.forEach((ride) => notifyRideChanged(ride));
  }
  return changed;
}

export function findRide(id) {
  return db.rides.find((ride) => ride.id === id);
}

export function findActiveRide(user) {
  runRideMaintenance();
  return db.rides.find((ride) => ride[ownerKey(user)] === user.id && isActive(ride));
}

export function listRidesFor(user) {
  runRideMaintenance();
  return db.rides
    .filter((ride) => ride[ownerKey(user)] === user.id && ride.status !== 'scheduled')
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
}

export function listUpcomingRides(customer) {
  runRideMaintenance();
  return db.rides
    .filter((ride) => ride.customerId === customer.id && ride.status === 'scheduled')
    .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
}

export function getOwnRide(user, id) {
  const ride = findRide(id);
  if (!ride || (user.role !== 'admin' && ride[ownerKey(user)] !== user.id)) {
    throw notFound('RIDE_NOT_FOUND', 'Ride not found.');
  }
  return ride;
}

// What the driver takes home: the full pre-discount fare (the platform funds promos),
// or the cancellation fee when a rider cancels late.
export function driverEarningsFor(ride) {
  if (!ride.driverId) return 0;
  if (ride.status === 'completed') return ride.driverEarnings ?? ride.subtotal ?? ride.fare;
  if (ride.status === 'cancelled') return ride.cancellationFee ?? 0;
  return 0;
}

export function serializeRide(ride, viewer) {
  const customer = findUserById(ride.customerId);
  const result = {
    id: ride.id,
    status: ride.status,
    rideType: ride.rideType,
    rideTypeLabel: rideTypes[ride.rideType]?.label ?? ride.rideType,
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    distanceKm: ride.distanceKm,
    durationMin: ride.durationMin,
    subtotal: ride.subtotal ?? ride.fare,
    discount: ride.discount ?? 0,
    promoCode: ride.promoCode ?? null,
    fare: ride.fare,
    paymentMethod: ride.paymentMethod,
    scheduledFor: ride.scheduledFor ?? null,
    requestedAt: ride.requestedAt,
    acceptedAt: ride.acceptedAt ?? null,
    arrivedAt: ride.arrivedAt ?? null,
    startedAt: ride.startedAt ?? null,
    completedAt: ride.completedAt ?? null,
    cancelledAt: ride.cancelledAt ?? null,
    cancelledBy: ride.cancelledBy ?? null,
    cancelReason: ride.cancelReason ?? null,
    cancellationFee: ride.cancellationFee ?? 0,
    rating: ride.rating ?? null,
    riderRating: ride.riderRating ?? null,
    customer: { name: ride.customerName, rating: customer ? riderRating(customer) : null },
    driver: ride.driver ? { ...ride.driver } : null,
  };

  // Phone numbers are shared between rider and driver only while their trip is under way,
  // so past trips don't keep exposing them. Support (admin) can always see both.
  const sharePhones = viewer.role === 'admin' || ['accepted', 'arrived', 'in_progress'].includes(ride.status);
  if (sharePhones) {
    result.customer.phone = ride.customerPhone;
  } else if (result.driver) {
    delete result.driver.phone;
  }

  if (viewer.role !== 'customer') {
    result.driverEarnings = driverEarningsFor(ride);
  }

  if (viewer.role === 'customer') {
    // Only the rider sees the OTP; they read it out to the driver to start the trip.
    if (['accepted', 'arrived'].includes(ride.status)) result.otp = ride.otp;
    if (['requested', 'accepted', 'arrived', 'scheduled'].includes(ride.status)) {
      result.cancellationFeeIfCancelledNow = cancellationFee(ride);
    }

    const driver = ride.driverId ? findUserById(ride.driverId) : null;
    if (driver && isActive(ride)) {
      result.driverLocation = driver.driver.location;
      if (driver.driver.location && ride.status === 'accepted' && isValidCoordinate(ride.pickup)) {
        const km = straightLineKm(driver.driver.location, ride.pickup) * 1.35;
        result.driverEtaMin = Math.max(1, Math.round((km / 24) * 60));
      }
    }
  }

  return result;
}

function isFirstRide(customer) {
  return !db.rides.some((ride) => ride.customerId === customer.id && (
    ride.status === 'completed'
    || (ride.promoCode === 'WELCOME50' && (isActive(ride) || ride.status === 'scheduled'))
  ));
}

// Fare quote for every ride type, with the promo applied when one is given.
export function quoteTrip(customer, body) {
  const pickup = parsePlace(body.pickup, 'pickup');
  const dropoff = parsePlace(body.dropoff, 'drop-off');
  const trip = resolveTrip({ pickup, dropoff, distanceKm: Number(body.distanceKm), durationMin: Number(body.durationMin) });
  const code = normalizePromoCode(body.promoCode);
  const firstRide = customer ? isFirstRide(customer) : true;

  let promo = null;
  const estimates = Object.entries(rideTypes).map(([id, type]) => {
    const subtotal = calculateFare(id, trip);
    const evaluation = code ? evaluatePromo(code, subtotal, { isFirstRide: firstRide }) : { discount: 0 };
    if (code && !promo) promo = { code, valid: !evaluation.error, message: evaluation.error ?? null };
    return {
      id,
      label: type.label,
      seats: type.seats,
      description: type.description,
      subtotal,
      discount: evaluation.discount ?? 0,
      fare: subtotal - (evaluation.discount ?? 0),
      promoError: evaluation.error ?? null,
    };
  });

  // A code is valid for the quote if at least one ride type can use it.
  if (promo) {
    const usable = estimates.find((estimate) => !estimate.promoError);
    promo = usable ? { code, valid: true, message: null } : { code, valid: false, message: estimates[0].promoError };
  }

  return { pickup, dropoff, trip, estimates, promo, firstRide };
}

function parseScheduledFor(value) {
  if (value == null || value === '') return null;
  const time = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(time)) throw badRequest('INVALID_SCHEDULE', 'Choose a valid pickup time.');
  if (time - now < minScheduleLeadMs) throw badRequest('INVALID_SCHEDULE', 'Scheduled rides must be at least 20 minutes from now.');
  if (time - now > maxScheduleAheadMs) throw badRequest('INVALID_SCHEDULE', 'You can schedule rides up to 7 days ahead.');
  return new Date(time).toISOString();
}

export function createRide(customer, body) {
  const scheduledFor = parseScheduledFor(body.scheduledFor);

  if (scheduledFor) {
    const upcoming = db.rides.filter((ride) => ride.customerId === customer.id && ride.status === 'scheduled');
    if (upcoming.length >= maxUpcomingRides) {
      throw conflict('TOO_MANY_SCHEDULED', `You can have up to ${maxUpcomingRides} scheduled rides.`);
    }
  } else if (findActiveRide(customer)) {
    throw conflict('RIDE_IN_PROGRESS', 'You already have an active ride.');
  }

  const rideType = typeof body.rideType === 'string' ? body.rideType : '';
  const paymentMethod = paymentMethods.includes(body.paymentMethod) ? body.paymentMethod : 'cash';
  if (!Object.hasOwn(rideTypes, rideType)) {
    throw badRequest('INVALID_RIDE_TYPE', 'Choose a ride type.');
  }

  const quote = quoteTrip(customer, body);
  if (quote.pickup.address.toLowerCase() === quote.dropoff.address.toLowerCase()) {
    throw badRequest('SAME_LOCATION', 'Pickup and drop-off must be different.');
  }

  const estimate = quote.estimates.find((option) => option.id === rideType);
  if (quote.promo && estimate.promoError) {
    throw badRequest('INVALID_PROMO', estimate.promoError);
  }

  const now = new Date().toISOString();
  const ride = {
    id: crypto.randomUUID(),
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone,
    driverId: null,
    driver: null,
    declinedBy: [],
    pickup: quote.pickup,
    dropoff: quote.dropoff,
    rideType,
    paymentMethod,
    ...quote.trip,
    subtotal: estimate.subtotal,
    discount: estimate.discount,
    promoCode: quote.promo ? quote.promo.code : null,
    fare: estimate.fare,
    otp: String(crypto.randomInt(1000, 10000)),
    status: scheduledFor ? 'scheduled' : 'requested',
    scheduledFor,
    createdAt: now,
    requestedAt: now,
  };

  // Persist first: if the write fails, the ride never appears in memory either.
  save(ride);
  db.rides.push(ride);
  notifyRideChanged(ride);
  return ride;
}

function assertDriverCanWork(driverUser) {
  if (driverApprovalStatus(driverUser) !== 'approved') {
    throw new HttpError(403, 'DRIVER_NOT_APPROVED', 'Your account is waiting for document verification.');
  }
}

export function listOpenRequests(driverUser) {
  runRideMaintenance();
  if (driverApprovalStatus(driverUser) !== 'approved' || !driverUser.driver.isOnline || findActiveRide(driverUser)) return [];

  const location = driverUser.driver.location;
  return db.rides
    .filter((ride) => ride.status === 'requested'
      && ride.rideType === driverUser.driver.vehicleType
      && !ride.declinedBy.includes(driverUser.id))
    .map((ride) => {
      const customer = findUserById(ride.customerId);
      return {
        id: ride.id,
        rideType: ride.rideType,
        pickup: ride.pickup,
        dropoff: ride.dropoff,
        distanceKm: ride.distanceKm,
        durationMin: ride.durationMin,
        fare: ride.fare,
        driverEarnings: ride.subtotal ?? ride.fare,
        paymentMethod: ride.paymentMethod,
        requestedAt: ride.requestedAt,
        scheduledFor: ride.scheduledFor ?? null,
        customer: { name: ride.customerName, rating: customer ? riderRating(customer) : null },
        pickupDistanceKm: location && isValidCoordinate(ride.pickup)
          ? Math.round(straightLineKm(location, ride.pickup) * 10) / 10
          : null,
      };
    })
    .sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt));
}

function requireStatus(ride, allowed, message) {
  if (!allowed.includes(ride.status)) {
    throw conflict('INVALID_RIDE_STATE', message);
  }
}

export function acceptRide(driverUser, rideId) {
  runRideMaintenance();
  assertDriverCanWork(driverUser);
  const ride = findRide(rideId);
  if (!ride) throw notFound('RIDE_NOT_FOUND', 'Ride not found.');
  if (!driverUser.driver.isOnline) throw conflict('DRIVER_OFFLINE', 'Go online to accept rides.');
  if (findActiveRide(driverUser)) throw conflict('RIDE_IN_PROGRESS', 'Finish your current ride first.');
  if (ride.rideType !== driverUser.driver.vehicleType) throw conflict('VEHICLE_MISMATCH', 'This request is for a different vehicle type.');
  requireStatus(ride, ['requested'], 'This ride is no longer available.');

  ride.status = 'accepted';
  ride.acceptedAt = new Date().toISOString();
  ride.driverId = driverUser.id;
  ride.driver = {
    name: driverUser.name,
    phone: driverUser.phone,
    vehicleType: driverUser.driver.vehicleType,
    vehicleModel: driverUser.driver.vehicleModel,
    vehicleNumber: driverUser.driver.vehicleNumber,
    rating: driverRating(driverUser),
  };
  save(ride);
  notifyRideChanged(ride);
  return ride;
}

export function declineRide(driverUser, rideId) {
  const ride = findRide(rideId);
  // Only open requests this driver could actually be offered can be declined.
  if (!ride || ride.status !== 'requested' || ride.rideType !== driverUser.driver.vehicleType) {
    throw notFound('RIDE_NOT_FOUND', 'Ride not found.');
  }
  if (!ride.declinedBy.includes(driverUser.id)) {
    ride.declinedBy.push(driverUser.id);
    save(ride);
  }
  return ride;
}

export function markArrived(driverUser, rideId) {
  const ride = getOwnRide(driverUser, rideId);
  requireStatus(ride, ['accepted'], 'You can only mark arrival for an accepted ride.');
  ride.status = 'arrived';
  ride.arrivedAt = new Date().toISOString();
  // Recorded so the arrival cancellation fee only applies when GPS put the driver at the
  // pickup (within 500 m, with a recent fix).
  const location = driverUser.driver.location;
  ride.arrivalVerified = Boolean(location && isValidCoordinate(ride.pickup)
    && Date.now() - Date.parse(location.updatedAt) < 2 * minute
    && straightLineKm(location, ride.pickup) <= 0.5);
  save(ride);
  notifyRideChanged(ride);
  return ride;
}

export function startRide(driverUser, rideId, otp) {
  const ride = getOwnRide(driverUser, rideId);
  requireStatus(ride, ['accepted', 'arrived'], 'This ride cannot be started.');
  // A 4-digit code is guessable, so each ride allows only a few wrong attempts.
  if ((ride.otpFailures ?? 0) >= maxOtpAttempts) {
    throw new HttpError(429, 'OTP_LOCKED', 'Too many wrong OTP attempts. Ask the rider to cancel and book again.');
  }
  const submitted = Buffer.from(String(otp ?? '').trim().slice(0, 16));
  const expected = Buffer.from(ride.otp);
  const isMatch = submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected);
  if (!isMatch) {
    ride.otpFailures = (ride.otpFailures ?? 0) + 1;
    save(ride);
    const left = maxOtpAttempts - ride.otpFailures;
    throw badRequest('INVALID_OTP', `Incorrect OTP. ${left > 0 ? `${left} attempt${left === 1 ? '' : 's'} left.` : 'No attempts left.'}`);
  }
  ride.status = 'in_progress';
  ride.arrivedAt ??= new Date().toISOString();
  ride.startedAt = new Date().toISOString();
  save(ride);
  notifyRideChanged(ride);
  return ride;
}

export function completeRide(driverUser, rideId) {
  const ride = getOwnRide(driverUser, rideId);
  requireStatus(ride, ['in_progress'], 'Only a ride in progress can be completed.');
  ride.status = 'completed';
  ride.completedAt = new Date().toISOString();
  ride.driverEarnings = ride.subtotal ?? ride.fare;
  save(ride);
  notifyRideChanged(ride);
  return ride;
}

export function cancelRide(user, rideId, reason) {
  const ride = getOwnRide(user, rideId);
  const note = cleanText(reason, 200);

  if (user.role === 'customer') {
    requireStatus(ride, ['scheduled', 'requested', 'accepted', 'arrived'], 'This ride can no longer be cancelled.');
    cancel(ride, 'customer', note || 'Cancelled by rider.', cancellationFee(ride));
    save(ride);
    notifyRideChanged(ride);
    return ride;
  }

  if (user.role === 'admin') {
    requireStatus(ride, ['scheduled', ...activeStatuses], 'Only upcoming or active rides can be cancelled.');
    cancel(ride, 'admin', note || 'Cancelled by support.');
    save(ride);
    notifyRideChanged(ride);
    return ride;
  }

  // A driver backing out sends the request back to the pool so another driver can take it.
  requireStatus(ride, ['accepted', 'arrived'], 'This ride can no longer be cancelled.');
  ride.declinedBy.push(user.id);
  ride.status = 'requested';
  ride.driverId = null;
  ride.driver = null;
  delete ride.acceptedAt;
  delete ride.arrivedAt;
  ride.requestedAt = new Date().toISOString();
  save(ride);
  notifyRideChanged(ride, [user.id]);
  return ride;
}

function parseRating(rating) {
  const score = Number(rating);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw badRequest('INVALID_RATING', 'Rating must be between 1 and 5.');
  }
  return score;
}

export function rateRide(customer, rideId, rating) {
  const ride = getOwnRide(customer, rideId);
  requireStatus(ride, ['completed'], 'You can rate a ride after it is completed.');
  if (ride.rating) throw conflict('ALREADY_RATED', 'You have already rated this ride.');
  const score = parseRating(rating);

  ride.rating = score;
  const driver = findUserById(ride.driverId);
  if (driver) {
    driver.driver.ratingTotal += score;
    driver.driver.ratingCount += 1;
  }
  save(ride, driver);
  notifyRideChanged(ride);
  return ride;
}

export function rateRider(driverUser, rideId, rating) {
  const ride = getOwnRide(driverUser, rideId);
  requireStatus(ride, ['completed'], 'You can rate the rider after the trip is completed.');
  if (ride.riderRating) throw conflict('ALREADY_RATED', 'You have already rated this rider.');
  const score = parseRating(rating);

  ride.riderRating = score;
  const customer = findUserById(ride.customerId);
  if (customer) {
    const rider = riderProfile(customer);
    rider.ratingTotal += score;
    rider.ratingCount += 1;
  }
  save(ride, customer);
  return ride;
}

export function setDriverOnline(driverUser, isOnline) {
  if (typeof isOnline !== 'boolean') {
    throw badRequest('INVALID_AVAILABILITY', 'isOnline must be true or false.');
  }
  if (isOnline) assertDriverCanWork(driverUser);
  if (!isOnline && findActiveRide(driverUser)) {
    throw new HttpError(409, 'RIDE_IN_PROGRESS', 'Finish your current ride before going offline.');
  }
  driverUser.driver.isOnline = isOnline;
  save(driverUser);
  syncDriverRooms(driverUser);
}

export function setDriverLocation(driverUser, body) {
  const point = { lat: Number(body?.lat), lng: Number(body?.lng) };
  if (!isValidCoordinate(point)) {
    throw badRequest('INVALID_LOCATION', 'A valid latitude and longitude are required.');
  }
  driverUser.driver.location = { ...point, updatedAt: new Date().toISOString() };
  // Location pings are frequent and not worth a disk write each time.
  const ride = db.rides.find((candidate) => candidate.driverId === driverUser.id && isActive(candidate));
  if (ride) notifyRideChanged(ride, [], { participantsOnly: true });
}

// Calendar days (server local time) ending today, oldest first.
export function lastDays(count, now = new Date()) {
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (count - 1 - index));
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {
      date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      label: start.toLocaleDateString('en-IN', { weekday: 'short' }),
      start: start.getTime(),
      end: end.getTime(),
    };
  });
}

// When a ride's money was earned: completion time, or cancellation time for a late-cancel fee.
const settledAt = (ride) => Date.parse(ride.completedAt ?? ride.cancelledAt ?? ride.requestedAt);

export function driverSummary(driverUser) {
  const rides = listRidesFor(driverUser);
  const paid = rides.filter((ride) => driverEarningsFor(ride) > 0);
  const days = lastDays(7);
  const today = days[days.length - 1];
  const inDay = (ride, day) => settledAt(ride) >= day.start && settledAt(ride) < day.end;

  return {
    isOnline: driverUser.driver.isOnline,
    rating: driverRating(driverUser),
    ratingCount: driverUser.driver.ratingCount,
    todayEarnings: paid.filter((ride) => inDay(ride, today)).reduce((total, ride) => total + driverEarningsFor(ride), 0),
    todayTrips: rides.filter((ride) => ride.status === 'completed' && inDay(ride, today)).length,
    totalEarnings: paid.reduce((total, ride) => total + driverEarningsFor(ride), 0),
    totalTrips: rides.filter((ride) => ride.status === 'completed').length,
    daily: days.map((day) => ({
      date: day.date,
      label: day.label,
      earnings: paid.filter((ride) => inDay(ride, day)).reduce((total, ride) => total + driverEarningsFor(ride), 0),
      trips: rides.filter((ride) => ride.status === 'completed' && inDay(ride, day)).length,
    })),
  };
}
