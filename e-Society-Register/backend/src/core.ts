import 'dotenv/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Express, Request, RequestHandler, Response } from 'express';
import type { Server } from 'socket.io';
import type { Model } from 'mongoose';
import jwt from 'jsonwebtoken';
import { z, ZodError, type ZodType } from 'zod';
import * as db from './models.js';

export const phone = z.string().regex(/^(?:\+91)?[0-9]{10}$/, 'Enter exactly 10 digits after +91')
  .transform(value => value.startsWith('+91') ? value : '+91' + value);
export const id = z.string().regex(/^[a-f\d]{24}$/i);
export const text = z.string().trim().min(1).max(500);
export const date = z.string().date();
export const dob = date.refine(value => value <= istDate(), 'Enter a date of birth in the past');
export const instant = z.string().datetime({ offset: true }).transform(value => new Date(value));
export const httpUrl = z.string().url().refine(value => /^https?:\/\//.test(value));
export const states = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);
export const visitStates = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'NO_RESPONSE', 'CANCELLED', 'CHECKED_IN', 'CHECKED_OUT', 'EXPIRED']);
export const guardStates = z.enum(['PENDING', 'APPROVED', 'REMOVED']);
export const memberStates = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'REMOVED']);
export const relations = z.enum(['SPOUSE', 'SON', 'DAUGHTER', 'PARENT', 'SIBLING', 'TENANT', 'OTHER']);
export const emergencyTypes = z.enum(['AMBULANCE', 'FIRE', 'POLICE', 'OTHER']);

const configuration = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  JWT_ACCESS_SECRET: z.string().min(32), JWT_SIGNUP_SECRET: z.string().min(32), QR_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default('http://localhost:5173').transform(value => value.split(',').map(origin => origin.trim())),
  OTP_MODE: z.enum(['twilio', 'dev']).default('twilio'),
  TWILIO_ACCOUNT_SID: z.string().optional(), TWILIO_AUTH_TOKEN: z.string().optional(), TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(), CLOUDINARY_API_KEY: z.string().optional(), CLOUDINARY_API_SECRET: z.string().optional()
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production' && value.OTP_MODE === 'dev') {
    ctx.addIssue({ code: 'custom', path: ['OTP_MODE'], message: 'Development OTP is disabled in production' });
  }
  if (value.OTP_MODE === 'twilio') {
    for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'] as const) {
      if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required with OTP_MODE=twilio' });
    }
  }
  const cloudKeys = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;
  if (cloudKeys.some(key => value[key])) {
    for (const key of cloudKeys) if (!value[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required when configuring Cloudinary' });
  }
  for (const origin of value.CORS_ORIGINS) {
    try {
      if (!/^https?:/.test(origin) || new URL(origin).origin !== origin) throw new Error();
    } catch { ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'Use comma-separated HTTP(S) origins without paths' }); }
  }
});
const configurationResult = configuration.safeParse(process.env);
if (!configurationResult.success) {
  console.error('Invalid backend .env', configurationResult.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = configurationResult.data;

const errorStatuses = {
  VALIDATION_ERROR: 400, UNAUTHORIZED: 401, TOKEN_EXPIRED: 401, FORBIDDEN: 403, NOT_FOUND: 404, HOME_NOT_FOUND: 404,
  OTP_INVALID: 400, OTP_RATE_LIMITED: 429, RATE_LIMITED: 429, PHONE_ALREADY_USED: 409, FLAT_ALREADY_EXISTS: 409,
  ALREADY_MEMBER: 409, SOCIETY_NOT_APPROVED: 409, DUTY_ALREADY_STARTED: 409, NO_ACTIVE_DUTY: 409, NOT_ON_DUTY_AT_GATE: 403,
  ALREADY_HANDLED: 409, VEHICLE_REQUIRED: 400, CHILD_PROTECTION_BLOCKED: 403, HELPER_NOT_FOUND: 404,
  QR_INVALID: 400, QR_EXPIRED: 400, QR_ALREADY_USED: 409, ENTRY_REQUIRED: 409, WRONG_SOCIETY: 403,
  VISIT_NOT_APPROVED: 409, INVALID_STATE: 409, UPLOAD_INVALID: 400, INTERNAL_ERROR: 500
} as const;
type ErrorCode = keyof typeof errorStatuses;
export class ApiError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) { super(message); }
  get status() { return errorStatuses[this.code]; }
}
export function fail(code: ErrorCode, message = code.toLowerCase().replaceAll('_', ' '), details?: unknown): never {
  throw new ApiError(code, message, details);
}
export function errorResponse(error: unknown, res: Response) {
  if (error instanceof ZodError) error = new ApiError('VALIDATION_ERROR', 'Check the submitted fields', error.flatten().fieldErrors);
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    error = new ApiError('VALIDATION_ERROR', 'Invalid JSON', { body: ['Expected JSON'] });
  }
  if (duplicate(error)) error = new ApiError('INVALID_STATE', 'This record already exists');
  if (!(error instanceof ApiError)) {
    console.error('Request failed', error instanceof Error ? error.name : 'Unknown error');
    error = new ApiError('INTERNAL_ERROR', 'The request could not be completed');
  }
  const api = error as ApiError;
  res.status(api.status).json({ error: { code: api.code, message: api.message, details: api.details } });
}
export const duplicate = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const key = (value: any): string => String(value?._id ?? value);
export const same = (left: any, right: any) => key(left) === key(right);
export const name = (user: any) => [user.firstName, user.lastName].filter(Boolean).join(' ');
export const label = (flat: any) => `${flat.wing}-${flat.flatNumber}`;
export function istDate(now = new Date()) {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
export function isChild(user: any) {
  if (!user.dateOfBirth) return true;
  const [year, month, day] = user.dateOfBirth.split('-').map(Number);
  return istDate() < `${year + 18}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function qr(visit: any) {
  return key(visit) + '.' + createHmac('sha256', env.QR_SECRET).update(key(visit)).digest('base64url');
}
export async function readQr(token: string) {
  const visitId = token.split('.')[0];
  if (!id.safeParse(visitId).success) fail('QR_INVALID', 'Invalid visitor QR');
  const visit = await db.Visit.findById(visitId);
  if (!visit?.qrTokenHash || !timingSafeEqual(Buffer.from(visit.qrTokenHash, 'hex'), Buffer.from(hash(token), 'hex'))) {
    fail('QR_INVALID', 'Invalid visitor QR');
  }
  return visit;
}
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function authenticate(token?: string) {
  if (!token) fail('UNAUTHORIZED', 'Sign in to continue');
  let claims: any;
  try { claims = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }); }
  catch (error) {
    if (error instanceof jwt.TokenExpiredError) fail('TOKEN_EXPIRED', 'Session access expired');
    fail('UNAUTHORIZED', 'Invalid session');
  }
  if (!id.safeParse(claims?.sub).success || !id.safeParse(claims?.sid).success) fail('UNAUTHORIZED');
  const session = await db.Session.findOne({ _id: claims.sid, user: claims.sub, revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!session) fail('UNAUTHORIZED', 'Session ended');
  const user = await db.User.findById(claims.sub);
  if (!user) fail('UNAUTHORIZED');
  return { user, session };
}
export type Identity = Awaited<ReturnType<typeof authenticate>>;
export type Context = Identity & { params: Record<string, string>; body: any; query: any; req: Request };
const empty = z.object({}).strict();
const pagination = { page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20) };
export const listQuery = (extra: Record<string, ZodType> = {}) => z.object({ ...pagination, ...extra }).strict();
export const listed = (data: unknown[], page = 1, limit = data.length || 20, total = data.length) => ({ data, meta: { page, limit, total } });
export async function list(collection: Model<any>, filter: Record<string, unknown>, query: { page: number; limit: number },
  shape: (row: any) => unknown | Promise<unknown>, sort: Record<string, 1 | -1> = { createdAt: -1, _id: -1 }) {
  const [rows, total] = await Promise.all([
    collection.find(filter).sort(sort).skip((query.page - 1) * query.limit).limit(query.limit), collection.countDocuments(filter)
  ]);
  return listed(await Promise.all(rows.map(shape)), query.page, query.limit, total);
}
export function register(app: Express, method: 'get' | 'post' | 'patch' | 'delete', path: string,
  options: { public?: boolean; body?: ZodType; query?: ZodType; middleware?: RequestHandler },
  handler: (ctx: Context) => unknown | Promise<unknown>) {
  const params = z.object(Object.fromEntries([...path.matchAll(/:(\w+)/g)].map(match => [match[1], id]))).strict();
  app[method]('/api/v1' + path, async (req, _res, next) => {
    if (!options.public) Object.assign(req, await authenticate(req.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1]));
    next();
  }, ...(options.middleware ? [options.middleware] : []), async (req, res) => {
    const identity = req as unknown as Identity;
    const result = await handler({ ...identityFields(identity), req, params: params.parse(req.params) as Record<string, string>,
      body: (options.body ?? empty).parse(req.body ?? {}), query: (options.query ?? empty).parse(req.query) });
    res.json(result && typeof result === 'object' && 'meta' in result ? result : { data: result });
  });
}
function identityFields({ user, session }: Identity) { return { user, session }; }
export async function get(collection: Model<any>, filter: Record<string, unknown>) {
  const row = await collection.findOne(filter);
  if (!row) fail('NOT_FOUND', 'Record not found');
  return row;
}
export function allowed(condition: unknown): asserts condition {
  if (!condition) fail('FORBIDDEN', 'You do not have permission in this context');
}
export function state(condition: unknown, message = 'This action is unavailable in the current state'): asserts condition {
  if (!condition) fail('INVALID_STATE', message);
}
export async function society(societyId: any, active = true) {
  const row = await get(db.Society, { _id: societyId });
  if (active && row.status !== 'APPROVED') fail('SOCIETY_NOT_APPROVED', 'This society is inactive. Contact the Platform Admin.');
  return row;
}
export async function secretary(user: any, societyId: any, active = true) {
  const row = await society(societyId, false);
  allowed(same(row.secretary, user));
  if (active && row.status !== 'APPROVED') fail('SOCIETY_NOT_APPROVED', 'This society is inactive. Contact the Platform Admin.');
  return row;
}
export async function guard(user: any, societyId: any) {
  const row = await db.Guard.findOne({ user: user._id, society: societyId, status: 'APPROVED' });
  allowed(row);
  await society(societyId);
  return row;
}
export async function duty(user: any, societyId: any, gateId?: any) {
  const worker = await guard(user, societyId);
  const current = await db.Duty.findOne({ guard: worker._id, endedAt: null });
  if (gateId && (!current || !current.gates.some((gate: any) => same(gate, gateId)) ||
      !await db.Gate.exists({ _id: gateId, society: societyId, isActive: true }))) {
    fail('NOT_ON_DUTY_AT_GATE', 'Start duty at this gate before recording a scan');
  }
  if (!current) fail('NO_ACTIVE_DUTY', 'Start duty to continue');
  return { worker, current };
}
export async function home(flatId: any, active = true) {
  const flat = await get(db.Flat, { _id: flatId });
  if (active) {
    await society(flat.society);
    state(flat.status === 'APPROVED', 'This home is inactive. Contact the Secretary.');
  }
  return flat;
}
export async function membership(user: any, flatId: any, capability: 'member' | 'head' | 'approve' = 'member') {
  const flat = await home(flatId);
  const member = await db.Member.findOne({ flat: flat._id, user: user._id, status: 'APPROVED' });
  allowed(member);
  if (capability === 'head') allowed(member.role === 'HEAD');
  if (capability === 'approve') allowed(member.role === 'HEAD' || member.canApproveVisitors);
  if (capability === 'approve') childCheck(flat, user);
  return { flat, member };
}
export function childCheck(flat: any, user: any) {
  if (flat.childProtection && isChild(user)) fail('CHILD_PROTECTION_BLOCKED', 'Child protection is on for this home');
}
let sockets: Server;
export function setSockets(server: Server) { sockets = server; }
export function emit(room: string, event: string, payload: unknown) { sockets?.to(room).emit(event, payload); }
export async function membershipChanged(userId: any, scope: 'SOCIETY' | 'FLAT' | 'GUARD', entityId: any) {
  const connections = await sockets?.in('user:' + key(userId)).fetchSockets();
  await Promise.all((connections ?? []).map(async connection => {
    const next = await rooms(userId);
    for (const room of connection.rooms) {
      if (/^(flat|society):/.test(room) && !next.includes(room)) await connection.leave(room);
    }
    await connection.join(next);
  }));
  emit('user:' + key(userId), 'membership:updated', { scope, id: key(entityId) });
}
export async function rooms(userId: any) {
  const [properties, guards, memberships] = await Promise.all([
    db.Society.find({ status: 'APPROVED' }).select('secretary'),
    db.Guard.find({ user: userId, status: 'APPROVED' }).select('society'),
    db.Member.find({ user: userId, status: 'APPROVED' }).select('flat')
  ]);
  const approved = new Set(properties.map(key));
  const homes = await db.Flat.find({ _id: { $in: memberships.map(member => member.flat) },
    society: { $in: [...approved] }, status: 'APPROVED' }).select('_id');
  return ['user:' + key(userId), ...properties.filter(property => same(property.secretary, userId)).map(property => 'society:' + key(property)),
    ...guards.filter(guard => approved.has(key(guard.society))).map(guard => 'society:' + key(guard.society)),
    ...homes.map(home => 'flat:' + key(home))];
}
export const notification = (row: any) => ({ id: key(row), type: row.type, title: row.title, body: row.body,
  data: row.data ?? {}, readAt: row.readAt ?? null, createdAt: row.createdAt });
export async function notify(users: any[], type: string, title: string, data: Record<string, string>, body = title) {
  await Promise.all([...new Set(users.filter(Boolean).map(key))].map(async user => {
    const row = await db.Notification.create({ user, type, title, body, data });
    emit('user:' + user, 'notification:new', notification(row));
  }));
}
export async function audit(actor: any, societyId: any, action: string, entityType: string, entityId: any, metadata = {}) {
  await db.Audit.create({ actor: actor._id, society: societyId, action, entityType, entityId, metadata });
}
export async function approvers(flat: any) {
  const members = await db.Member.find({ flat: flat._id, status: 'APPROVED', $or: [{ role: 'HEAD' }, { canApproveVisitors: true }] });
  if (!flat.childProtection) return members.map(member => member.user);
  const users = await db.User.find({ _id: { $in: members.map(member => member.user) } });
  return users.filter(user => !isChild(user)).map(user => user._id);
}

// Serializes related multi-document writes within the prototype's single API process.
const locks = new Map<string, Promise<void>>();
export async function serialize<T>(resource: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(resource);
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  locks.set(resource, next);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (locks.get(resource) === next) locks.delete(resource);
  }
}
