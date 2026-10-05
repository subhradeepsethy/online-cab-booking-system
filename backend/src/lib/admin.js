import { readUpload } from './files.js';
import { badRequest, conflict, notFound } from './httpError.js';
import { disconnectUser, notifyAccountChanged, syncDriverRooms } from './realtime.js';
import { activeStatuses, driverEarningsFor, lastDays, runRideMaintenance, serializeRide } from './rides.js';
import { db, recordAudit, save } from './store.js';
import { cleanText, documentTypes, driverApprovalStatus, driverRating, findUserById, publicUser, riderRating } from './users.js';

const adminViewer = { role: 'admin' };

// Money the platform collected from a ride: the fare for completed trips, or the late-cancel fee.
const collectedFor = (ride) => {
  if (ride.status === 'completed') return ride.fare;
  if (ride.status === 'cancelled') return ride.cancellationFee ?? 0;
  return 0;
};

const settledAt = (ride) => Date.parse(ride.completedAt ?? ride.cancelledAt ?? ride.requestedAt);

export function adminOverview() {
  runRideMaintenance();
  const days = lastDays(7);
  const today = days[days.length - 1];
  const drivers = db.users.filter((user) => user.role === 'driver');
  const completed = db.rides.filter((ride) => ride.status === 'completed');
  const inDay = (ride, day) => settledAt(ride) >= day.start && settledAt(ride) < day.end;

  return {
    counts: {
      riders: db.users.filter((user) => user.role === 'customer').length,
      drivers: drivers.length,
      driversOnline: drivers.filter((driver) => driver.driver.isOnline && !driver.blocked).length,
      pendingApprovals: drivers.filter((driver) => driverApprovalStatus(driver) === 'pending').length,
      activeRides: db.rides.filter((ride) => activeStatuses.includes(ride.status)).length,
      searchingRides: db.rides.filter((ride) => ride.status === 'requested').length,
      scheduledRides: db.rides.filter((ride) => ride.status === 'scheduled').length,
      completedRides: completed.length,
      cancelledRides: db.rides.filter((ride) => ride.status === 'cancelled').length,
    },
    revenue: {
      today: db.rides.filter((ride) => inDay(ride, today)).reduce((sum, ride) => sum + collectedFor(ride), 0),
      total: db.rides.reduce((sum, ride) => sum + collectedFor(ride), 0),
      discounts: completed.reduce((sum, ride) => sum + (ride.discount ?? 0), 0),
      driverPayouts: db.rides.reduce((sum, ride) => sum + driverEarningsFor(ride), 0),
    },
    daily: days.map((day) => ({
      date: day.date,
      label: day.label,
      trips: completed.filter((ride) => inDay(ride, day)).length,
      revenue: db.rides.filter((ride) => inDay(ride, day)).reduce((sum, ride) => sum + collectedFor(ride), 0),
    })),
  };
}

const matchesQuery = (query, ...fields) => !query || fields.some((field) => String(field ?? '').toLowerCase().includes(query));

export function adminListRides({ status, q } = {}) {
  runRideMaintenance();
  const query = typeof q === 'string' ? q.trim().toLowerCase() : '';

  return db.rides
    .filter((ride) => {
      if (status === 'active') return activeStatuses.includes(ride.status);
      if (status && status !== 'all') return ride.status === status;
      return true;
    })
    .filter((ride) => matchesQuery(query, ride.id, ride.customerName, ride.customerPhone, ride.driver?.name, ride.driver?.vehicleNumber, ride.pickup.address, ride.dropoff.address))
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
    .slice(0, 300)
    .map((ride) => serializeRide(ride, adminViewer));
}

function adminUserView(user) {
  const key = user.role === 'driver' ? 'driverId' : 'customerId';
  const rides = db.rides.filter((ride) => ride[key] === user.id);
  const completed = rides.filter((ride) => ride.status === 'completed');

  return {
    ...publicUser(user),
    blocked: Boolean(user.blocked),
    stats: {
      trips: completed.length,
      cancelled: rides.filter((ride) => ride.status === 'cancelled').length,
      amount: user.role === 'driver'
        ? rides.reduce((sum, ride) => sum + driverEarningsFor(ride), 0)
        : rides.reduce((sum, ride) => sum + collectedFor(ride), 0),
      rating: user.role === 'driver' ? driverRating(user) : riderRating(user),
      hasActiveRide: rides.some((ride) => activeStatuses.includes(ride.status)),
    },
  };
}

export function adminListUsers({ role, q, filter } = {}) {
  const query = typeof q === 'string' ? q.trim().toLowerCase() : '';
  return db.users
    .filter((user) => user.role === role)
    .filter((user) => matchesQuery(query, user.name, user.phone, user.driver?.vehicleNumber))
    .filter((user) => {
      if (filter === 'blocked') return user.blocked;
      if (filter === 'pending') return user.role === 'driver' && driverApprovalStatus(user) === 'pending';
      if (filter === 'online') return user.role === 'driver' && user.driver.isOnline;
      return true;
    })
    .sort((a, b) => {
      // Drivers waiting for review float to the top so they get handled first.
      const pending = (user) => (user.role === 'driver' && driverApprovalStatus(user) === 'pending' ? 0 : 1);
      return pending(a) - pending(b) || Date.parse(b.createdAt) - Date.parse(a.createdAt);
    })
    .map(adminUserView);
}

function getManagedUser(id) {
  const user = findUserById(id);
  if (!user || user.role === 'admin') throw notFound('USER_NOT_FOUND', 'User not found.');
  return user;
}

// Validates the whole request before changing anything, so a partly invalid request never
// leaves an account half-updated.
export function adminUpdateUser(admin, id, body = {}) {
  const user = getManagedUser(id);
  const hasActiveRide = db.rides.some((ride) => (ride.customerId === id || ride.driverId === id) && activeStatuses.includes(ride.status));
  const wantsBlock = body.blocked !== undefined;
  const wantsApproval = body.approvalStatus !== undefined;
  let note = '';

  if (!wantsBlock && !wantsApproval) throw badRequest('INVALID_UPDATE', 'Nothing to update.');

  if (wantsBlock) {
    if (typeof body.blocked !== 'boolean') throw badRequest('INVALID_UPDATE', 'blocked must be true or false.');
    if (body.blocked && hasActiveRide) throw conflict('RIDE_IN_PROGRESS', 'This user has an active ride. Cancel it before blocking.');
  }

  if (wantsApproval) {
    if (user.role !== 'driver') throw badRequest('INVALID_UPDATE', 'Only drivers can be approved.');
    if (!['approved', 'rejected'].includes(body.approvalStatus)) throw badRequest('INVALID_UPDATE', 'approvalStatus must be approved or rejected.');

    if (body.approvalStatus === 'approved') {
      const missing = Object.keys(documentTypes).filter((type) => !user.driver.documents?.[type]);
      if (missing.length > 0) {
        throw conflict('MISSING_DOCUMENTS', `Driver has not uploaded: ${missing.map((type) => documentTypes[type]).join(', ')}.`);
      }
    } else {
      note = cleanText(body.note, 300);
      if (!note) throw badRequest('NOTE_REQUIRED', 'Tell the driver why their documents were rejected.');
      if (hasActiveRide) throw conflict('RIDE_IN_PROGRESS', 'This driver has an active ride.');
    }
  }

  if (wantsBlock) {
    user.blocked = body.blocked;
    if (user.blocked) {
      if (user.role === 'driver') user.driver.isOnline = false;
      // Invalidate every token the user holds, not just future logins.
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    }
    recordAudit(admin, body.blocked ? 'user.block' : 'user.unblock', { userId: user.id, userName: user.name, role: user.role });
  }

  if (wantsApproval) {
    user.driver.approvalStatus = body.approvalStatus;
    user.driver.approvalNote = body.approvalStatus === 'rejected' ? note : null;
    if (body.approvalStatus === 'rejected') user.driver.isOnline = false;
    recordAudit(admin, `driver.${body.approvalStatus === 'approved' ? 'approve' : 'reject'}`, {
      userId: user.id, userName: user.name, ...(note ? { note } : {}),
    });
  }

  save(user);
  if (user.role === 'driver') syncDriverRooms(user);
  notifyAccountChanged(user.id);
  if (user.blocked) disconnectUser(user.id);
  return adminUserView(user);
}

export function adminAuditLog(limit = 200) {
  return db.auditLog.slice(-limit).reverse();
}

export function adminDocumentFile(userId, type) {
  const user = getManagedUser(userId);
  const document = Object.hasOwn(documentTypes, type) ? user.driver?.documents?.[type] : null;
  const buffer = document ? readUpload(document.fileId) : null;
  if (!buffer) throw notFound('DOCUMENT_NOT_FOUND', 'Document not found.');
  return { buffer, mimeType: document.mimeType, fileName: document.fileName };
}
