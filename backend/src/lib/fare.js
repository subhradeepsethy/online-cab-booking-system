// Fares are in Indian rupees. Each ride type has a base fare, a per-km and a per-minute rate,
// and a minimum fare, similar to how Ola and Uber price trips.
export const rideTypes = {
  bike: { label: 'Bike', seats: 1, baseFare: 20, perKm: 6, perMin: 1, minimumFare: 30, description: 'Beat the traffic on two wheels' },
  auto: { label: 'Auto', seats: 3, baseFare: 30, perKm: 11, perMin: 1, minimumFare: 40, description: 'Everyday auto rickshaw rides' },
  mini: { label: 'Mini', seats: 4, baseFare: 50, perKm: 13, perMin: 1.5, minimumFare: 80, description: 'Affordable compact cars' },
  sedan: { label: 'Sedan', seats: 4, baseFare: 70, perKm: 16, perMin: 2, minimumFare: 110, description: 'Comfortable sedans with extra legroom' },
  suv: { label: 'SUV', seats: 6, baseFare: 100, perKm: 21, perMin: 2.5, minimumFare: 160, description: 'Spacious rides for groups' },
};

export const paymentMethods = ['cash', 'upi', 'card'];

const averageCitySpeedKmh = 24;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function isValidCoordinate(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}

export function straightLineKm(from, to) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Works out the trip distance the fare is based on. The browser may send the road distance
// Google measured, but the client can't be trusted with money: a claimed distance is only used
// when both ends have coordinates, and it is clamped to what's physically plausible (a road is
// never shorter than the straight line, and rarely more than ~4x longer). Without coordinates
// the claim is ignored and a stable estimate derived from the addresses is used instead.
export function resolveTrip({ pickup, dropoff, distanceKm, durationMin }) {
  let distance;
  if (isValidCoordinate(pickup) && isValidCoordinate(dropoff)) {
    const straight = straightLineKm(pickup, dropoff);
    distance = Number.isFinite(distanceKm) && distanceKm > 0
      ? clamp(distanceKm, Math.max(straight, 0.3), straight * 4 + 3)
      : Math.max(straight * 1.35, 0.5);
  } else {
    const key = `${pickup?.address ?? ''}|${dropoff?.address ?? ''}`.toLowerCase();
    let hash = 0;
    for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    distance = 3 + (hash % 220) / 10;
  }

  // Between motorway speed (80 km/h) and walking pace (5 km/h).
  const duration = Number.isFinite(durationMin) && durationMin > 0
    ? clamp(durationMin, (distance / 80) * 60, (distance / 5) * 60)
    : (distance / averageCitySpeedKmh) * 60;

  return {
    distanceKm: Math.round(distance * 10) / 10,
    durationMin: Math.max(1, Math.round(duration)),
  };
}

export function calculateFare(rideType, { distanceKm, durationMin }) {
  const pricing = rideTypes[rideType];
  const fare = pricing.baseFare + pricing.perKm * distanceKm + pricing.perMin * durationMin;
  return Math.round(Math.max(fare, pricing.minimumFare));
}

export const promoCodes = {
  WELCOME50: { kind: 'percent', value: 50, maxDiscount: 100, firstRideOnly: true, description: '50% off your first ride, up to ₹100' },
  RIDE20: { kind: 'percent', value: 20, maxDiscount: 75, description: '20% off any ride, up to ₹75' },
  FLAT30: { kind: 'flat', value: 30, minFare: 150, description: '₹30 off rides of ₹150 or more' },
};

export const normalizePromoCode = (code) => (typeof code === 'string' ? code.trim().toUpperCase() : '');

// Returns { discount } for a usable code or { error } explaining why it can't be used.
export function evaluatePromo(code, subtotal, { isFirstRide = true } = {}) {
  const promo = Object.hasOwn(promoCodes, code) ? promoCodes[code] : null;
  if (!promo) return { error: 'This promo code is not valid.' };
  if (promo.firstRideOnly && !isFirstRide) return { error: `${code} is only for your first ride.` };
  if (promo.minFare && subtotal < promo.minFare) return { error: `${code} needs a fare of at least ₹${promo.minFare}.` };

  const raw = promo.kind === 'percent' ? (subtotal * promo.value) / 100 : promo.value;
  const discount = Math.round(Math.min(raw, promo.maxDiscount ?? raw, subtotal));
  return { discount };
}

// Rider cancellation fee, paid to the driver for their time: free until the driver has been
// on the way for a while, then a small fee, and a larger one once the driver is waiting.
export const cancellationPolicy = { graceMinutes: 3, afterAcceptFee: 25, afterArrivalFee: 50 };

// The arrival fee only applies when the driver's GPS confirmed they were at the pickup, so a
// driver can't tap "arrived" from across town to collect it. Otherwise the normal rule applies.
export function cancellationFee(ride, now = Date.now()) {
  if (ride.status === 'arrived' && ride.arrivalVerified) return cancellationPolicy.afterArrivalFee;
  if (['accepted', 'arrived'].includes(ride.status) && now - Date.parse(ride.acceptedAt) > cancellationPolicy.graceMinutes * 60 * 1000) {
    return cancellationPolicy.afterAcceptFee;
  }
  return 0;
}
