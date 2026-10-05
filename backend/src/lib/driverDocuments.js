import { env } from '../config/env.js';
import { deleteUpload, readUpload, saveUpload } from './files.js';
import { badRequest, conflict, notFound } from './httpError.js';
import { notifyAccountChanged, syncDriverRooms } from './realtime.js';
import { activeStatuses } from './rides.js';
import { db, save } from './store.js';
import { cleanText, documentTypes, driverApprovalStatus } from './users.js';

export function uploadDriverDocument(driverUser, type, body = {}) {
  // Object.hasOwn, not `in`: names like "__proto__" must never be accepted as a document type.
  if (!Object.hasOwn(documentTypes, type)) throw badRequest('INVALID_DOCUMENT_TYPE', 'Unknown document type.');

  const hasActiveRide = db.rides.some((ride) => ride.driverId === driverUser.id && activeStatuses.includes(ride.status));
  const status = driverApprovalStatus(driverUser);
  if (status === 'approved' && env.requireDriverApproval && hasActiveRide) {
    throw conflict('RIDE_IN_PROGRESS', 'Finish your current ride before changing documents.');
  }

  const fileId = saveUpload(body);
  // Display name only (files are stored under a random id); keep it short and path-free.
  const fileName = cleanText(body.fileName, 120).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || type;

  driverUser.driver.documents ??= {};
  deleteUpload(driverUser.driver.documents[type]?.fileId);
  driverUser.driver.documents[type] = {
    fileId,
    fileName,
    mimeType: body.mimeType,
    uploadedAt: new Date().toISOString(),
  };

  // New or replaced documents need a fresh review before the driver can take trips again.
  if (env.requireDriverApproval && status !== 'pending') {
    driverUser.driver.approvalStatus = 'pending';
    driverUser.driver.isOnline = false;
    syncDriverRooms(driverUser);
  }

  save(driverUser);
  notifyAccountChanged(driverUser.id);
}

export function readDriverDocument(driverUser, type) {
  const document = Object.hasOwn(documentTypes, type) ? driverUser.driver.documents?.[type] : null;
  const buffer = document ? readUpload(document.fileId) : null;
  if (!buffer) throw notFound('DOCUMENT_NOT_FOUND', 'Document not found.');
  return { buffer, mimeType: document.mimeType, fileName: document.fileName };
}
