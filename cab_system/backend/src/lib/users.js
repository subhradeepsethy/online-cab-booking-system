import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { hashPassword, verifyToken } from './auth.js';
import { isValidCoordinate, rideTypes } from './fare.js';
import { badRequest, conflict } from './httpError.js';
import { db, save } from './store.js';

export const roles = ['customer', 'driver', 'admin'];
export const signupRoles = ['customer', 'driver'];
export const savedPlaceLabels = ['home', 'work'];

export const passwordRules = { minLength: 8, adminMinLength: 12, maxLength: 128 };

export const documentTypes = {
  license: 'Driving licence',
  rc: 'Vehicle registration (RC)',
  insurance: 'Vehicle insurance',
};

// Normalizes user-supplied text: drops control/invisible characters and collapses whitespace.
// Output is rendered by React (which escapes HTML), so this is about keeping data clean and
// bounded rather than HTML-encoding. Zero-width (non-)joiners are kept because Indic scripts
// such as Devanagari and Odia need them to shape letters correctly.
export function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, maxLength * 4)
    .normalize('NFKC')
    .replace(/(?![‌‍])[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePhone(value) {
  const digits = String(value ?? '').slice(0, 32).replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

export function findUserById(id) {
  return typeof id === 'string' ? db.users.find((user) => user.id === id) : undefined;
}

export function findUserByPhone(role, phone) {
  return db.users.find((user) => user.role === role && user.phone === phone);
}

// Resolves a bearer token to its user, rejecting revoked tokens (logout, block).
export function userFromToken(token) {
  const claims = verifyToken(token);
  const user = claims ? findUserById(claims.sub) : null;
  if (!user || (claims.ver ?? 0) !== (user.tokenVersion ?? 0)) return null;
  return user;
}

export function revokeSessions(user) {
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  save(user);
}

const average = ({ ratingTotal = 0, ratingCount = 0 } = {}) => (
  ratingCount > 0 ? Math.round((ratingTotal / ratingCount) * 10) / 10 : null
);

export const driverRating = (user) => average(user.driver);
export const riderRating = (user) => average(user.rider);

// Accounts created before driver approval existed are treated as approved.
export const driverApprovalStatus = (user) => user.driver?.approvalStatus ?? 'approved';

// Rider data is added lazily so accounts created before these features keep working.
export function riderProfile(user) {
  user.rider ??= { ratingTotal: 0, ratingCount: 0, savedPlaces: {} };
  user.rider.savedPlaces ??= {};
  return user.rider;
}

export function publicUser(user) {
  const result = {
    id: user.id,
    role: user.role,
    name: user.name,
    phone: user.phone,
    createdAt: user.createdAt,
  };

  if (user.role === 'customer') {
    const rider = riderProfile(user);
    result.rider = {
      rating: riderRating(user),
      ratingCount: rider.ratingCount,
      savedPlaces: rider.savedPlaces,
    };
  }

  if (user.role === 'driver') {
    const documents = user.driver.documents ?? {};
    result.driver = {
      vehicleType: user.driver.vehicleType,
      vehicleModel: user.driver.vehicleModel,
      vehicleNumber: user.driver.vehicleNumber,
      isOnline: user.driver.isOnline,
      rating: driverRating(user),
      ratingCount: user.driver.ratingCount ?? 0,
      approvalStatus: driverApprovalStatus(user),
      approvalNote: user.driver.approvalNote ?? null,
      documents: Object.fromEntries(Object.entries(documentTypes).map(([type, label]) => [type, {
        label,
        uploaded: Boolean(documents[type]),
        fileName: documents[type]?.fileName ?? null,
        mimeType: documents[type]?.mimeType ?? null,
        uploadedAt: documents[type]?.uploadedAt ?? null,
      }])),
    };
  }

  return result;
}

export function validatePassword(password, role) {
  const minLength = role === 'admin' ? passwordRules.adminMinLength : passwordRules.minLength;
  if (typeof password !== 'string' || password.length < minLength || password.length > passwordRules.maxLength) {
    throw badRequest('INVALID_PASSWORD', `Password must be ${minLength}-${passwordRules.maxLength} characters.`);
  }
}

// `verifyPhone`, when given, runs after all fields are validated but before the account is
// created, so a typo in another field doesn't use up the user's SMS code.
export async function createUser(input, { allowAdmin = false, verifyPhone } = {}) {
  const role = typeof input.role === 'string' ? input.role : '';
  const name = cleanText(input.name, 60);
  const phone = normalizePhone(input.phone);
  const { password } = input;

  if (!(allowAdmin ? roles : signupRoles).includes(role)) throw badRequest('INVALID_ROLE', 'Choose whether you are signing up as a rider or a driver.');
  if (name.length < 2 || name.length > 60) throw badRequest('INVALID_NAME', 'Enter your full name (2-60 characters).');
  if (!/^[6-9]\d{9}$/.test(phone)) throw badRequest('INVALID_PHONE', 'Enter a valid 10-digit Indian mobile number.');
  validatePassword(password, role);

  let driver;
  if (role === 'driver') {
    const vehicleType = typeof input.vehicleType === 'string' ? input.vehicleType : '';
    const vehicleModel = cleanText(input.vehicleModel, 60);
    const vehicleNumber = cleanText(input.vehicleNumber, 15).toUpperCase();

    if (!Object.hasOwn(rideTypes, vehicleType)) throw badRequest('INVALID_VEHICLE_TYPE', 'Choose the type of vehicle you drive.');
    if (vehicleModel.length < 2 || vehicleModel.length > 60) throw badRequest('INVALID_VEHICLE_MODEL', 'Enter your vehicle make and model.');
    if (!/^[A-Z0-9][A-Z0-9 -]{2,13}[A-Z0-9]$/.test(vehicleNumber)) throw badRequest('INVALID_VEHICLE_NUMBER', 'Enter your vehicle registration number (letters, digits and spaces).');

    driver = {
      vehicleType,
      vehicleModel,
      vehicleNumber,
      isOnline: false,
      location: null,
      ratingTotal: 0,
      ratingCount: 0,
      approvalStatus: env.requireDriverApproval ? 'pending' : 'approved',
      approvalNote: null,
      documents: {},
    };
  }

  if (findUserByPhone(role, phone)) throw conflict('PHONE_TAKEN', `A ${role === 'customer' ? 'rider' : role} account with this mobile number already exists.`);
  if (verifyPhone) verifyPhone(phone);
  const passwordHash = await hashPassword(password);
  // Re-check after the (slow) hash so two simultaneous sign-ups can't both succeed.
  if (findUserByPhone(role, phone)) throw conflict('PHONE_TAKEN', `A ${role === 'customer' ? 'rider' : role} account with this mobile number already exists.`);

  const user = {
    id: crypto.randomUUID(),
    role,
    name,
    phone,
    passwordHash,
    tokenVersion: 0,
    blocked: false,
    phoneVerifiedAt: verifyPhone ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
  };
  if (role === 'customer') riderProfile(user);
  if (driver) user.driver = driver;

  // Persist first: the database's unique (role, phone) index is the final guard against
  // duplicate accounts, and a rejected write must not leave the user in memory.
  try {
    save(user);
  } catch (error) {
    if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') throw conflict('PHONE_TAKEN', 'An account with this mobile number already exists.');
    throw error;
  }
  db.users.push(user);
  return user;
}

export function setSavedPlace(customer, label, value) {
  if (!savedPlaceLabels.includes(label)) throw badRequest('INVALID_PLACE_LABEL', 'Saved places can be Home or Work.');
  const address = cleanText(value?.address, 300);
  if (!address) throw badRequest('INVALID_LOCATION', 'Enter an address to save.');

  const place = { address };
  const point = { lat: Number(value.lat), lng: Number(value.lng) };
  if (value.lat != null && value.lng != null && isValidCoordinate(point)) Object.assign(place, point);

  riderProfile(customer).savedPlaces[label] = place;
  save(customer);
  return place;
}

export function removeSavedPlace(customer, label) {
  if (!savedPlaceLabels.includes(label)) throw badRequest('INVALID_PLACE_LABEL', 'Saved places can be Home or Work.');
  delete riderProfile(customer).savedPlaces[label];
  save(customer);
}

export const demoAccounts = [
  { role: 'customer', name: 'Demo Rider', phone: '9000000001', password: 'demo1234' },
  {
    role: 'driver', name: 'Demo Driver', phone: '9000000002', password: 'demo1234',
    vehicleType: 'mini', vehicleModel: 'Maruti Suzuki Swift', vehicleNumber: 'OD 02 AB 1234',
  },
  { role: 'admin', name: 'Demo Admin', phone: '9000000000', password: 'admin1234567' },
];

// Local development only (env.js refuses SEED_DEMO_ACCOUNTS in production). Existing demo
// accounts get their documented password back so the login hints stay accurate.
export async function seedDemoAccounts() {
  for (const account of demoAccounts) {
    let user = findUserByPhone(account.role, account.phone);
    if (user) {
      user.passwordHash = await hashPassword(account.password);
    } else {
      user = await createUser(account, { allowAdmin: true });
      // The demo driver skips document review so the app can be tried straight away.
      if (user.role === 'driver') user.driver.approvalStatus = 'approved';
    }
    save(user);
  }
}

export async function seedAdminFromEnv() {
  if (!env.adminPhone || !env.adminPassword) return;
  if (findUserByPhone('admin', normalizePhone(env.adminPhone))) return;
  await createUser({ role: 'admin', name: 'Administrator', phone: env.adminPhone, password: env.adminPassword }, { allowAdmin: true });
}
