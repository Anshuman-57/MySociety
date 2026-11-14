import * as db from './models.js';
import { key, label, name, qr, same } from './core.js';

export function user(row: any) {
  return { id: key(row), firstName: row.firstName ?? '', lastName: row.lastName ?? null, dateOfBirth: row.dateOfBirth ?? '',
    phone: row.phone, profilePhotoUrl: row.profilePhotoUrl ?? null, isPlatformAdmin: !!row.isPlatformAdmin };
}
export function society(row: any) {
  return { id: key(row), name: row.name, address: row.address, city: row.city, state: row.state, country: row.country,
    pincode: row.pincode, latitude: row.latitude ?? null, longitude: row.longitude ?? null, status: row.status,
    rejectionReason: row.rejectionReason ?? null, secretaryUserId: key(row.secretary), createdAt: row.createdAt };
}
export const document = (row: any) => ({ id: key(row), societyId: key(row.society), documentType: row.documentType, fileUrl: row.fileUrl });
export const gate = (row: any) => ({ id: key(row), societyId: key(row.society), gateNumber: row.gateNumber, name: row.name ?? null, isActive: row.isActive });
export async function guard(row: any) {
  return { id: key(row), societyId: key(row.society), user: user(await db.User.findById(row.user)), status: row.status, approvedAt: row.approvedAt ?? null };
}
export async function duty(row: any) {
  const gates = await db.Gate.find({ _id: { $in: row.gates } });
  return { id: key(row), guardId: key(row.guard), societyId: key(row.society), startedAt: row.startedAt, endedAt: row.endedAt ?? null, gates: gates.map(gate) };
}
export const flat = (row: any) => ({ id: key(row), societyId: key(row.society), wing: row.wing, flatNumber: row.flatNumber,
  floorNumber: row.floorNumber ?? null, status: row.status, childProtection: row.childProtection, muteVisitorAlerts: row.muteVisitorAlerts, label: label(row) });
export async function member(row: any) {
  return { id: key(row), flatId: key(row.flat), user: user(await db.User.findById(row.user)), role: row.role, relation: row.relation,
    status: row.status, canApproveVisitors: row.canApproveVisitors, approvedAt: row.approvedAt ?? null };
}
export const guest = (row: any) => ({ id: key(row), name: row.name, defaultValidMinutes: row.defaultValidMinutes,
  requiresVehicleNumber: row.requiresVehicleNumber, isActive: row.isActive });
export const person = (row: any) => ({ id: key(row), name: name(row) });
export const walkin = (row: any) => ({ id: key(row), societyId: key(row.society), phone: row.phone, name: row.name, photoUrl: row.photoUrl ?? null });
export async function visit(row: any, viewer: { resident?: boolean; secretary?: boolean; guardId?: any; visitorId?: any } = {}, withQr = false) {
  const [home, type, visitor, responder] = await Promise.all([
    db.Flat.findById(row.flat), db.GuestType.findById(row.guestType), row.visitor && db.User.findById(row.visitor),
    (viewer.resident || viewer.secretary) && row.respondedBy && db.User.findById(row.respondedBy)
  ]);
  const isWalkIn = !!row.walkInProfile;
  const snapshot = isWalkIn ? row.visitorSnapshot : visitor && { name: name(visitor), phone: visitor.phone, photoUrl: visitor.profilePhotoUrl };
  return {
    id: key(row), societyId: key(row.society), flat: { id: key(home), label: label(home) }, guestType: guest(type),
    purpose: row.purpose, vehicleNumber: row.vehicleNumber ?? null, status: row.status, isWalkIn,
    visitor: snapshot ? { name: snapshot.name, photoUrl: snapshot.photoUrl ?? null,
      phone: viewer.resident || viewer.secretary || (isWalkIn && viewer.guardId && same(viewer.guardId, row.createdByGuard)) ? snapshot.phone ?? null : null } : null,
    validFrom: row.validFrom ?? null, validUntil: row.validUntil ?? null, respondedBy: responder ? person(responder) : null,
    respondedAt: row.respondedAt ?? null, entryAt: row.entryAt ?? null, exitAt: row.exitAt ?? null,
    isOverstayed: row.status === 'CHECKED_IN' && !!row.validUntil && row.validUntil < new Date(),
    recurringPassId: row.recurringPassId ? key(row.recurringPassId) : null, createdAt: row.createdAt,
    ...(withQr && row.visitor && viewer.visitorId && same(row.visitor, viewer.visitorId) && row.qrTokenHash &&
      ['APPROVED', 'CHECKED_IN'].includes(row.status) ? { qrToken: qr(row) } : {})
  };
}
export async function pass(row: any, includeLocation = false) {
  const [helper, type] = await Promise.all([db.User.findById(row.helper), db.GuestType.findById(row.guestType)]);
  const home = includeLocation ? await db.Flat.findById(row.flat) : null;
  const property = home ? await db.Society.findById(home.society) : null;
  return { id: key(row), flatId: key(row.flat), helper: user(helper), guestType: guest(type), daysOfWeek: row.daysOfWeek,
    startTime: row.startTime, endTime: row.endTime, validFrom: row.validFrom, validTo: row.validTo ?? null, isActive: row.isActive,
    ...(property ? { flat: { id: key(home), label: label(home) }, society: { id: key(property), name: property.name } } : {}) };
}
export async function emergency(row: any) {
  const [gateRow, worker] = await Promise.all([db.Gate.findById(row.gate), db.Guard.findById(row.guard)]);
  return { id: key(row), societyId: key(row.society), gate: gate(gateRow), guard: person(await db.User.findById(worker.user)),
    type: row.type, vehicleNumber: row.vehicleNumber ?? null, note: row.note ?? null, createdAt: row.createdAt };
}
export async function audit(row: any) {
  return { id: key(row), societyId: row.society ? key(row.society) : null, actor: person(await db.User.findById(row.actor)),
    action: row.action, entityType: row.entityType, entityId: key(row.entityId), metadata: row.metadata ?? {}, createdAt: row.createdAt };
}
