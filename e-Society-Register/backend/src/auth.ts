import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import twilio from 'twilio';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { z } from 'zod';
import * as db from './models.js';
import * as shape from './shapes.js';
import { chooseWorkspace, loginRole, type LoginRole, type Workspace } from './login-role.js';
import { dob, duplicate, env, fail, hash, httpUrl, key, list, listQuery, phone, register, same, serialize, text } from './core.js';

const verify = env.OTP_MODE === 'twilio'
  ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN).verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID!)
  : null;
const otp = z.string().regex(/^\d{6}$/);
const refreshToken = z.string().regex(/^[\w-]{64}$/);
const nameFields = { firstName: text.max(80), lastName: text.max(80).optional() };
const rate = new Map<string, { count: number; until: number }>();
const cleanup = setInterval(() => {
  for (const [key, entry] of rate) if (entry.until <= Date.now()) rate.delete(key);
}, 60_000);
cleanup.unref();
export function limit(key: string, max: number, ms: number, code: 'OTP_RATE_LIMITED' | 'RATE_LIMITED' = 'RATE_LIMITED') {
  const now = Date.now();
  const found = rate.get(key);
  const current = found && found.until > now ? found : { count: 0, until: now + ms };
  if (current.count >= max) fail(code, 'Too many attempts. Try again shortly.');
  current.count++;
  rate.set(key, current);
}
async function requestOtp(to: string, ip = '') {
  limit('otp-ip:' + ip, 10, 3_600_000, 'OTP_RATE_LIMITED');
  limit('otp-cooldown:' + to, 1, 30_000, 'OTP_RATE_LIMITED');
  limit('otp-send:' + to, 3, 600_000, 'OTP_RATE_LIMITED');
  if (verify) {
    try { await verify.verifications.create({ to, channel: 'sms' }); }
    catch (error) {
      if (typeof error === 'object' && error && 'status' in error && error.status === 429) fail('OTP_RATE_LIMITED', 'Try again shortly');
      fail('INTERNAL_ERROR', 'SMS verification is temporarily unavailable');
    }
  }
  return { sent: true, resendAfterSeconds: 30 };
}
async function checkOtp(to: string, code: string) {
  limit('otp-check:' + to, 10, 600_000, 'OTP_RATE_LIMITED');
  let approved = code === '123456';
  if (verify) {
    try { approved = (await verify.verificationChecks.create({ to, code })).status === 'approved'; }
    catch (error) {
      if (typeof error === 'object' && error && 'status' in error) {
        if (error.status === 429) fail('OTP_RATE_LIMITED', 'Try again shortly');
        if (error.status === 400 || error.status === 404) fail('OTP_INVALID', 'Incorrect or expired code');
      }
      fail('INTERNAL_ERROR', 'SMS verification is temporarily unavailable');
    }
  }
  if (!approved) fail('OTP_INVALID', 'Incorrect or expired code');
}
const newRefresh = () => randomBytes(48).toString('base64url');
function access(userId: any, session: any) {
  return jwt.sign({ sub: key(userId), sid: key(session) }, env.JWT_ACCESS_SECRET, { expiresIn: '15m', algorithm: 'HS256' });
}
async function workspaceFor(user: any, role: LoginRole) {
  const [properties, guards, members] = await Promise.all([
    db.Society.find({ status: 'APPROVED' }),
    db.Guard.find({ user: user._id, status: 'APPROVED' }),
    db.Member.find({ user: user._id, status: 'APPROVED' })
  ]);
  const activeSocieties = new Set(properties.map(key));
  const flats = await db.Flat.find({ _id: { $in: members.map(member => member.flat) },
    society: { $in: [...activeSocieties] }, status: 'APPROVED' });
  const workspaces: Workspace[] = [];
  if (user.isPlatformAdmin) workspaces.push({ role: 'ADMIN', id: 'admin', home: '/admin/societies' });
  if (properties.some(property => same(property.secretary, user))) workspaces.push({ role: 'SECRETARY', id: 'secretary', home: '/secretary' });
  for (const guard of guards) if (activeSocieties.has(key(guard.society))) {
    workspaces.push({ role: 'GUARD', id: 'guard:' + key(guard.society), home: '/guard' });
  }
  for (const role of ['HEAD', 'MEMBER'] as const) for (const member of members) {
    if (member.role === role && flats.some(flat => same(flat, member.flat))) {
      workspaces.push({ role: 'RESIDENT', id: 'home:' + key(member.flat), home: '/home/' + key(member.flat) });
    }
  }
  workspaces.push({ role: 'VISITOR', id: 'visitor', home: '/pass' });
  const workspace = chooseWorkspace(workspaces, role);
  if (!workspace) fail('FORBIDDEN', 'Your mobile number does not have an active ' + role.toLowerCase() + ' role. Ask the Platform Admin or society Secretary to add it.');
  return workspace;
}
async function signIn(user: any, deviceName?: string, ip?: string, role: LoginRole = 'AUTO') {
  const workspace = await workspaceFor(user, role);
  const refreshToken = newRefresh();
  const session = await db.Session.create({ user: user._id, refreshTokenHash: hash(refreshToken), deviceName: deviceName?.slice(0, 200),
    ip, lastUsedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86_400_000) });
  await db.WalkIn.updateMany({ phone: user.phone, linkedUser: null }, { linkedUser: user._id });
  return { accessToken: access(user, session), refreshToken, user: shape.user(user), workspace };
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } });
const validMime = (mime: string, bytes: Buffer) => (
  mime === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
  mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
  mime === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ||
  mime === 'application/pdf' && bytes.toString('ascii', 0, 5) === '%PDF-'
);
cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET });

export function authRoutes(app: Express) {
  const add: typeof register = register;
  add(app, 'post', '/auth/otp/request', { public: true, body: z.object({ phone }).strict() }, ({ body, req }) => requestOtp(body.phone, req.ip));
  add(app, 'post', '/auth/otp/verify', { public: true, body: z.object({ phone, code: otp, role: loginRole.default('AUTO') }).strict() }, async ({ body, req }) => {
    await checkOtp(body.phone, body.code);
    const user = await db.User.findOne({ phone: body.phone });
    if (user?.firstName && user?.dateOfBirth) {
      if (!user.phoneVerified) await db.User.updateOne({ _id: user._id }, { phoneVerified: true });
      return { isNewUser: false, ...await signIn(user, req.get('X-Device-Name'), req.ip, body.role) };
    }
    if (user) await workspaceFor(user, body.role);
    else if (body.role !== 'AUTO' && body.role !== 'VISITOR') fail('FORBIDDEN', 'Ask the Platform Admin or society Secretary to add your mobile number first.');
    return { isNewUser: true, signupToken: jwt.sign({ phone: body.phone, purpose: 'SIGNUP', role: body.role }, env.JWT_SIGNUP_SECRET, { expiresIn: '15m' }) };
  });
  add(app, 'post', '/auth/signup', { public: true, body: z.object({ signupToken: z.string().max(2048), ...nameFields, dateOfBirth: dob }).strict() },
    async ({ body, req }) => {
      let claims: any;
      try { claims = jwt.verify(body.signupToken, env.JWT_SIGNUP_SECRET, { algorithms: ['HS256'] }); }
      catch { fail('UNAUTHORIZED', 'Verify your phone again'); }
      if (claims?.purpose !== 'SIGNUP' || !phone.safeParse(claims.phone).success) fail('UNAUTHORIZED');
      const { firstName, lastName, dateOfBirth } = body;
      try {
        const selectedRole = loginRole.parse(claims.role ?? 'AUTO');
        const existing = await db.User.findOne({ phone: claims.phone });
        let user;
        if (existing) {
          user = await db.User.findOneAndUpdate({ _id: existing._id, $or: [
            { firstName: null }, { firstName: '' }, { dateOfBirth: null }, { dateOfBirth: '' }
          ] }, { firstName, lastName, dateOfBirth, phoneVerified: true }, { new: true });
          if (!user) fail('PHONE_ALREADY_USED', 'This phone already has a complete account');
        } else user = await db.User.create({ phone: claims.phone, firstName, lastName, dateOfBirth, phoneVerified: true });
        return await signIn(user, req.get('X-Device-Name'), req.ip, selectedRole);
      } catch (error) {
        if (duplicate(error)) fail('PHONE_ALREADY_USED', 'This phone already has an account');
        throw error;
      }
    });
  add(app, 'post', '/auth/refresh', { public: true, body: z.object({ refreshToken }).strict() }, async ({ body }) => {
    const previous = hash(body.refreshToken);
    const replacement = newRefresh();
    const session = await db.Session.findOneAndUpdate({ refreshTokenHash: previous, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { refreshTokenHash: hash(replacement), lastUsedAt: new Date() }, $push: { rotatedHashes: previous } }, { new: true });
    if (!session) {
      await db.Session.updateOne({ rotatedHashes: previous, revokedAt: null }, { revokedAt: new Date() });
      fail('UNAUTHORIZED', 'Session ended. Sign in again.');
    }
    return { accessToken: access(session.user, session), refreshToken: replacement };
  });
  add(app, 'post', '/auth/logout', { body: z.object({ refreshToken }).strict() }, async ({ session, body }) => {
    const submittedHash = hash(body.refreshToken);
    const revoked = await db.Session.updateOne({ _id: session._id, $or: [{ refreshTokenHash: submittedHash },
      { rotatedHashes: submittedHash }] }, { revokedAt: new Date() });
    if (!revoked.matchedCount) fail('UNAUTHORIZED', 'The refresh token does not belong to this session');
    return { ok: true };
  });
  add(app, 'post', '/auth/logout-all', {}, async ({ user }) => {
    await db.Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
    return { ok: true };
  });
  add(app, 'get', '/auth/sessions', { query: listQuery() }, ({ user, session, query }) =>
    list(db.Session, { user: user._id, revokedAt: null, expiresAt: { $gt: new Date() } }, query, row => ({
      id: key(row), deviceName: row.deviceName ?? null, lastUsedAt: row.lastUsedAt, createdAt: row.createdAt, isCurrent: same(row, session)
    })));
  add(app, 'get', '/me', {}, async ({ user }) => {
    const [secretaryOf, guards, members] = await Promise.all([
      db.Society.findOne({ secretary: user._id }), db.Guard.find({ user: user._id, status: { $in: ['APPROVED', 'PENDING'] } }),
      db.Member.find({ user: user._id, status: { $in: ['APPROVED', 'PENDING'] } })
    ]);
    return {
      user: shape.user(user), secretaryOf: secretaryOf ? shape.society(secretaryOf) : null,
      guardIn: await Promise.all(guards.map(async row => ({ guard: await shape.guard(row), society: shape.society(await db.Society.findById(row.society)) }))),
      flats: await Promise.all(members.map(async row => {
        const flat = await db.Flat.findById(row.flat);
        const society = await db.Society.findById(flat.society);
        return { member: await shape.member(row), flat: shape.flat(flat), society: { id: key(society), name: society.name, status: society.status } };
      }))
    };
  });
  add(app, 'patch', '/me', { body: z.object({ ...nameFields, firstName: nameFields.firstName.optional(), profilePhotoUrl: httpUrl.optional() }).strict() },
    async ({ user, body }) => ({ user: shape.user(await db.User.findByIdAndUpdate(user._id, body, { new: true })) }));
  add(app, 'post', '/me/phone/otp', { body: z.object({ newPhone: phone }).strict() }, ({ body, req }) => requestOtp(body.newPhone, req.ip));
  add(app, 'post', '/me/phone/verify', { body: z.object({ newPhone: phone, code: otp }).strict() }, async ({ user, body }) => {
    await checkOtp(body.newPhone, body.code);
    return serialize('phone:' + key(user), async () => {
      try {
        const updated = await db.User.findByIdAndUpdate(user._id, { phone: body.newPhone, phoneVerified: true }, { new: true });
        await db.WalkIn.updateMany({ phone: body.newPhone, linkedUser: null }, { linkedUser: user._id });
        return { user: shape.user(updated) };
      } catch (error) {
        if (duplicate(error)) fail('PHONE_ALREADY_USED', 'That phone belongs to another account');
        throw error;
      }
    });
  });
  add(app, 'post', '/uploads', {
    query: z.object({ purpose: z.enum(['PROFILE', 'SOCIETY_DOC', 'WALKIN']) }).strict(),
    middleware: (req, res, next) => upload.single('file')(req, res, error => {
      if (error) {
        res.status(400).json({ error: { code: 'UPLOAD_INVALID', message: 'Upload one file no larger than 5 MB' } });
      } else next();
    })
  }, async ({ req, query }) => {
    const file = req.file;
    if (!file || !validMime(file.mimetype, file.buffer) || (file.mimetype === 'application/pdf' && query.purpose !== 'SOCIETY_DOC')) {
      fail('UPLOAD_INVALID', 'Use a supported image or society PDF, up to 5 MB');
    }
    if (!env.CLOUDINARY_CLOUD_NAME) fail('INTERNAL_ERROR', 'File uploads require Cloudinary configuration');
    return await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream({ resource_type: 'image', folder: 'esociety/' + query.purpose.toLowerCase() }, (error, result) => {
        if (error || !result) reject(new Error('Cloudinary upload failed'));
        else resolve({ url: result.secure_url });
      }).end(file.buffer);
    });
  });
}
