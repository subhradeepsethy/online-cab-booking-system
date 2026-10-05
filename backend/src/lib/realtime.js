import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { parseCookies, sessionCookieName } from './cookies.js';
import { driverApprovalStatus, findUserById, roles, userFromToken } from './users.js';

// Browsers authenticate with their session cookie for the role they name; other clients can
// pass a token. Cross-site pages can't open a socket with the cookie: the origin must be allowed.
function socketToken(handshake) {
  if (typeof handshake.auth?.token === 'string') return handshake.auth.token;
  const role = handshake.auth?.role;
  if (!roles.includes(role)) return null;
  return parseCookies(handshake.headers.cookie)[sessionCookieName(role)] ?? null;
}

function isAllowedSocketOrigin(handshake) {
  const { origin, host } = handshake.headers;
  if (!origin) return true;
  if (env.corsOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Socket.IO pushes small "something changed" signals; clients then refetch over the REST API,
// which keeps one source of truth for permissions and serialization. When the server runs
// without sockets (tests), every function here is a no-op.
let io = null;

const userRoom = (userId) => `user:${userId}`;
const vehicleRoom = (vehicleType) => `vehicle:${vehicleType}`;
const adminRoom = 'role:admin';

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
    // Clients only listen; nothing legitimate sends large messages to the server.
    maxHttpBufferSize: 4 * 1024,
    allowRequest: (request, callback) => callback(null, isAllowedSocketOrigin(request)),
  });

  io.use((socket, next) => {
    const token = socketToken(socket.handshake);
    const user = token ? userFromToken(token) : null;
    if (!user || user.blocked) return next(new Error('UNAUTHORIZED'));
    socket.data.userId = user.id;
    return next();
  });

  io.on('connection', (socket) => {
    const user = findUserById(socket.data.userId);
    socket.join(userRoom(user.id));
    if (user.role === 'admin') socket.join(adminRoom);
    if (user.role === 'driver') syncDriverRooms(user);
  });

  return io;
}

// Drivers only hear about new requests while online and approved, for their own vehicle type.
export function syncDriverRooms(driverUser) {
  if (!io) return;
  const shouldListen = driverUser.driver.isOnline && driverApprovalStatus(driverUser) === 'approved' && !driverUser.blocked;
  const room = vehicleRoom(driverUser.driver.vehicleType);
  if (shouldListen) {
    io.in(userRoom(driverUser.id)).socketsJoin(room);
  } else {
    io.in(userRoom(driverUser.id)).socketsLeave(room);
  }
}

// `participantsOnly` is for frequent updates (driver location) that only the rider and driver need.
export function notifyRideChanged(ride, extraUserIds = [], { participantsOnly = false } = {}) {
  if (!io) return;
  const recipients = new Set([ride.customerId, ride.driverId, ...extraUserIds].filter(Boolean));
  recipients.forEach((userId) => io.to(userRoom(userId)).emit('ride:changed', { rideId: ride.id }));
  if (participantsOnly) return;
  io.to(vehicleRoom(ride.rideType)).emit('requests:changed');
  io.to(adminRoom).emit('admin:changed');
}

export function notifyAccountChanged(userId) {
  if (!io) return;
  io.to(userRoom(userId)).emit('account:changed');
  io.to(adminRoom).emit('admin:changed');
}

export function notifyAdmins() {
  io?.to(adminRoom).emit('admin:changed');
}

export function disconnectUser(userId) {
  io?.in(userRoom(userId)).disconnectSockets(true);
}
