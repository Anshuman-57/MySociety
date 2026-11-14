import mongoose, { Schema, type Model } from 'mongoose';

const id = Schema.Types.ObjectId;
type Index = [Record<string, 1 | -1>, mongoose.IndexOptions?];
function model(name: string, fields: mongoose.SchemaDefinition, indexes: Index[] = [], log = false): Model<any> {
  const schema = new Schema(fields, { timestamps: log ? { createdAt: true, updatedAt: false } : true });
  for (const [keys, options] of indexes) schema.index(keys, options);
  return mongoose.model(name, schema);
}

export const User = model('User', { firstName: String, lastName: String, dateOfBirth: String, phone: String,
  phoneVerified: Boolean, profilePhotoUrl: String, isPlatformAdmin: { type: Boolean, default: false } }, [[{ phone: 1 }, { unique: true }]]);
export const Session = model('Session', { user: id, refreshTokenHash: String, rotatedHashes: [String],
  deviceName: String, ip: String, lastUsedAt: Date, expiresAt: Date, revokedAt: Date },
  [[{ refreshTokenHash: 1 }, { unique: true }], [{ rotatedHashes: 1 }], [{ expiresAt: 1 }, { expireAfterSeconds: 0 }]]);
export const Society = model('Society', { name: String, address: String, city: String, state: String, country: String,
  pincode: String, latitude: Number, longitude: Number, secretary: id, status: String, rejectionReason: String,
  verifiedBy: id, verifiedAt: Date }, [[{ secretary: 1 }, { unique: true }]]);
export const SocietyDocument = model('SocietyDocument', { society: id, documentType: String, fileUrl: String });
export const Gate = model('Gate', { society: id, gateNumber: String, name: String, isActive: { type: Boolean, default: true } },
  [[{ society: 1, gateNumber: 1 }, { unique: true }]]);
export const Guard = model('Guard', { user: id, society: id, status: String, approvedAt: Date, approvedBy: id },
  [[{ user: 1, society: 1 }, { unique: true }]]);
export const Duty = model('GuardDuty', { guard: id, society: id, startedAt: Date, endedAt: { type: Date, default: null }, gates: [id] },
  [[{ guard: 1 }, { unique: true, partialFilterExpression: { endedAt: null } }]]);
export const Flat = model('Flat', { society: id, wing: String, flatNumber: String, floorNumber: Number, status: String,
  childProtection: { type: Boolean, default: false }, muteVisitorAlerts: { type: Boolean, default: false } },
  [[{ society: 1, wing: 1, flatNumber: 1 }, { unique: true }]]);
export const Member = model('FlatMember', { flat: id, user: id, role: String, relation: String, status: String,
  canApproveVisitors: { type: Boolean, default: true }, approvedAt: Date, approvedBy: id },
  [[{ flat: 1, user: 1 }, { unique: true }], [{ flat: 1 }, { unique: true, partialFilterExpression: { role: 'HEAD', status: 'APPROVED' } }]]);
export const GuestType = model('GuestType', { name: String, defaultValidMinutes: Number, requiresVehicleNumber: Boolean,
  isActive: { type: Boolean, default: true } }, [[{ name: 1 }, { unique: true }]]);
export const Visit = model('Visit', { society: id, flat: id, guestType: id, visitor: id, walkInProfile: id, createdByGuard: id,
  visitorSnapshot: { name: String, phone: String, photoUrl: String }, purpose: String, vehicleNumber: String,
  status: String, validFrom: Date, validUntil: Date, qrTokenHash: String, respondedBy: id, respondedAt: Date,
  cancelledAt: Date, recurringPassId: id, passDate: String, requestedAt: Date, noResponseAt: Date,
  overstayNotifiedAt: Date, entryAt: Date, exitAt: Date },
  [[{ recurringPassId: 1, passDate: 1 }, { unique: true, partialFilterExpression: { passDate: { $type: 'string' } } }],
   [{ status: 1, validUntil: 1 }], [{ society: 1, createdAt: -1 }], [{ flat: 1, createdAt: -1 }]]);
export const VisitScan = model('VisitScan', { visit: id, type: String, gate: id, guard: id, scannedAt: Date },
  [[{ visit: 1, type: 1 }, { unique: true }]], true);
export const WalkIn = model('WalkInProfile', { society: id, phone: String, name: String, photoUrl: String, linkedUser: id },
  [[{ society: 1, phone: 1 }, { unique: true }]]);
export const Extension = model('VisitExtension', { visit: id, extendedBy: id, oldValidUntil: Date, newValidUntil: Date }, [], true);
export const Pass = model('RecurringPass', { flat: id, helper: id, guestType: id, createdBy: id, daysOfWeek: [Number],
  startTime: String, endTime: String, validFrom: String, validTo: String, isActive: { type: Boolean, default: true } });
export const SuspiciousScan = model('SuspiciousScan', { visit: id, scannedBy: id }, [], true);
export const Emergency = model('EmergencyLog', { society: id, gate: id, guard: id, type: String, vehicleNumber: String, note: String }, [], true);
export const Notification = model('Notification', { user: id, type: String, title: String, body: String, data: Schema.Types.Mixed, readAt: Date }, [], true);
export const Audit = model('AuditLog', { society: id, actor: id, action: String, entityType: String, entityId: id, metadata: Schema.Types.Mixed }, [], true);

export async function connect(uri: string) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  await Promise.all(Object.values(mongoose.models).map(collection => collection.init()));
}
