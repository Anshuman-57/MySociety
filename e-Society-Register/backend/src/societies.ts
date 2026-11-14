import type { Express } from 'express';
import { z } from 'zod';
import * as db from './models.js';
import * as shape from './shapes.js';
import { accountByPhone } from './accounts.js';
import { allowed, audit, duplicate, emit, escapeRegex, fail, get, guard, guardStates, httpUrl, id, key, list, listed, listQuery, membershipChanged, notify, phone, register, same, secretary, serialize, society, state, states, text } from './core.js';

const fields = z.object({ name: text, address: text, city: text, state: text, country: text, pincode: text.max(16),
  latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }).strict();
const actionBody = z.object({ reason: text.optional() }).strict();

export async function onDuty(societyId: string) {
  const [gates, duties] = await Promise.all([db.Gate.find({ society: societyId, isActive: true }),
    db.Duty.find({ society: societyId, endedAt: null })]);
  const workers = await Promise.all(duties.map(async duty => ({
    duty, guard: shape.person(await db.User.findById((await db.Guard.findById(duty.guard)).user))
  })));
  return gates.map(gate => ({ gate: shape.gate(gate),
    guards: workers.filter(row => row.duty.gates.some((gateId: unknown) => same(gateId, gate))).map(row => row.guard) }));
}
export async function dutyChanged(societyId: string) {
  emit('society:' + societyId, 'duty:updated', { gates: await onDuty(societyId) });
}
export function societyRoutes(app: Express) {
  const add = register.bind(null, app);
  add('get', '/societies/search', { query: listQuery({ q: z.string().trim().max(100).default('') }) }, async ({ query }) => {
    const tokens = query.q.split(/\s+/).filter(Boolean);
    const filter = { status: 'APPROVED', ...(tokens.length ? { $and: tokens.map((token: string) => {
      const search = new RegExp(escapeRegex(token), 'i');
      return { $or: ['name', 'city', 'state', 'address', 'pincode'].map(field => ({ [field]: search })) };
    }) } : {}) };
    return list(db.Society, filter, query, row => ({ id: key(row), name: row.name, city: row.city,
      state: row.state, address: row.address, pincode: row.pincode }), { name: 1, _id: 1 });
  });
  add('post', '/societies', { body: fields.extend({ secretaryPhone: phone }) }, async ({ user, body }) => {
    allowed(user.isPlatformAdmin);
    const { secretaryPhone, ...details } = body;
    const assigned = await accountByPhone(secretaryPhone);
    let row;
    try { row = await db.Society.create({ ...details, secretary: assigned._id, status: 'APPROVED', verifiedBy: user._id, verifiedAt: new Date() }); }
    catch (error) {
      if (duplicate(error)) fail('INVALID_STATE', 'This Secretary already manages a society. Choose another mobile number.');
      throw error;
    }
    await membershipChanged(assigned._id, 'SOCIETY', row._id);
    await audit(user, row._id, 'SOCIETY_CREATED', 'SOCIETY', row._id, { secretaryUserId: key(assigned) });
    await notify([assigned._id], 'SOCIETY_ASSIGNED', 'You have been assigned as Secretary', { societyId: key(row) });
    return shape.society(row);
  });
  add('patch', '/societies/:societyId', { body: fields }, async ({ user, params, body }) => {
    await secretary(user, params.societyId, false);
    const row = await db.Society.findByIdAndUpdate(params.societyId, body, { new: true });
    await audit(user, params.societyId, 'SOCIETY_UPDATED', 'SOCIETY', row._id);
    return shape.society(row);
  });
  add('patch', '/admin/societies/:societyId/secretary', { body: z.object({ phone }).strict() }, async ({ user, params, body }) => {
    allowed(user.isPlatformAdmin);
    const row = await society(params.societyId, false);
    const previous = row.secretary;
    const assigned = await accountByPhone(body.phone);
    try { await row.set({ secretary: assigned._id }).save(); }
    catch (error) { if (duplicate(error)) fail('INVALID_STATE', 'This Secretary already manages another society.'); throw error; }
    await membershipChanged(previous, 'SOCIETY', row._id);
    await membershipChanged(assigned._id, 'SOCIETY', row._id);
    await audit(user, row._id, 'SECRETARY_ASSIGNED', 'SOCIETY', row._id, { previousUserId: key(previous), userId: key(assigned) });
    await notify([assigned._id], 'SOCIETY_ASSIGNED', 'You have been assigned as Secretary', { societyId: key(row) });
    return shape.society(row);
  });
  add('post', '/societies/:societyId/documents', { body: z.object({ documentType: text, fileUrl: httpUrl }).strict() },
    async ({ user, params, body }) => {
      await secretary(user, params.societyId, false);
      return shape.document(await db.SocietyDocument.create({ ...body, society: params.societyId }));
    });
  add('get', '/societies/:societyId', {}, async ({ user, params }) => {
    const row = await society(params.societyId, false);
    const privateAccess = user.isPlatformAdmin || same(row.secretary, user);
    if (!privateAccess) {
      const homes = await db.Flat.find({ society: row._id, status: 'APPROVED' }).distinct('_id');
      allowed(await db.Guard.exists({ society: row._id, user: user._id, status: 'APPROVED' }) ||
        await db.Member.exists({ flat: { $in: homes }, user: user._id, status: 'APPROVED' }));
    }
    return { society: shape.society(row), documents: privateAccess ? (await db.SocietyDocument.find({ society: row._id })).map(shape.document) : [] };
  });
  add('get', '/admin/societies', { query: listQuery({ status: states.optional() }) }, ({ user, query }) => {
    allowed(user.isPlatformAdmin);
    return list(db.Society, query.status ? { status: query.status } : {}, query, async row => ({
      ...shape.society(row), secretary: shape.user(await db.User.findById(row.secretary)),
      documents: (await db.SocietyDocument.find({ society: row._id })).map(shape.document)
    }));
  });
  for (const [action, status, before] of [['activate', 'APPROVED', ['PENDING', 'REJECTED', 'SUSPENDED']],
    ['suspend', 'SUSPENDED', ['APPROVED']]] as const) {
    add('post', '/admin/societies/:societyId/' + action, { body: actionBody }, async ({ user, params, body }) => {
      allowed(user.isPlatformAdmin);
      await society(params.societyId, false);
      const row = await db.Society.findOneAndUpdate({ _id: params.societyId, status: { $in: before } }, {
        status, rejectionReason: body.reason ?? null, verifiedBy: user._id, verifiedAt: new Date()
      }, { new: true });
      state(row);
      if (status === 'SUSPENDED') {
        await db.Duty.updateMany({ society: row._id, endedAt: null }, { endedAt: new Date() });
      }
      const homes = await db.Flat.find({ society: row._id }).distinct('_id');
      const [workers, members] = await Promise.all([
        db.Guard.find({ society: row._id, status: 'APPROVED' }).distinct('user'),
        db.Member.find({ flat: { $in: homes }, status: 'APPROVED' }).distinct('user')
      ]);
      await Promise.all([...new Set([...workers, ...members].map(key))].map(target => membershipChanged(target, 'SOCIETY', row._id)));
      await audit(user, row._id, 'SOCIETY_' + status, 'SOCIETY', row._id, body);
      await membershipChanged(row.secretary, 'SOCIETY', row._id);
      await notify([row.secretary], 'SOCIETY_' + status, 'Society ' + status.toLowerCase(), { societyId: key(row) }, body.reason);
      return shape.society(row);
    });
  }
  add('get', '/guest-types', { query: listQuery() }, ({ query }) => list(db.GuestType, { isActive: true }, query, shape.guest, { name: 1 }));
  add('get', '/societies/:societyId/gates', { query: listQuery() }, async ({ user, params, query }) => {
    const row = await society(params.societyId);
    if (!same(row.secretary, user)) await guard(user, row._id);
    return list(db.Gate, { society: row._id }, query, shape.gate, { gateNumber: 1 });
  });
  add('post', '/societies/:societyId/gates', { body: z.object({ gateNumber: text.max(30), name: text.optional() }).strict() }, async ({ user, params, body }) => {
    await secretary(user, params.societyId);
    return shape.gate(await db.Gate.create({ ...body, society: params.societyId }));
  });
  add('patch', '/societies/:societyId/gates/:gateId', { body: z.object({ name: text.optional(), isActive: z.boolean().optional() }).strict() },
    async ({ user, params, body }) => {
      await secretary(user, params.societyId);
      const gate = await get(db.Gate, { _id: params.gateId, society: params.societyId });
      await gate.set(body).save();
      await dutyChanged(params.societyId);
      return shape.gate(gate);
    });
  add('post', '/societies/:societyId/guards/join', {}, () => {
    fail('FORBIDDEN', 'Only the society Secretary can add Guards by mobile number.');
  });
  add('post', '/societies/:societyId/guards', { body: z.object({ phone }).strict() }, async ({ user, params, body }) => {
    await secretary(user, params.societyId);
    const assigned = await accountByPhone(body.phone);
    const row = await serialize('guard:' + params.societyId + ':' + key(assigned), async () => {
      const existing = await db.Guard.findOne({ user: assigned._id, society: params.societyId });
      if (existing?.status === 'APPROVED') fail('ALREADY_MEMBER', 'This Guard is already added to your society.');
      const details = { status: 'APPROVED', approvedAt: new Date(), approvedBy: user._id };
      return existing ? existing.set(details).save() : db.Guard.create({ user: assigned._id, society: params.societyId, ...details });
    });
    await audit(user, params.societyId, 'GUARD_ADDED', 'GUARD', row._id);
    await membershipChanged(assigned._id, 'GUARD', row._id);
    await notify([assigned._id], 'GUARD_ADDED', 'You have been added as a Guard', { societyId: params.societyId, guardId: key(row) });
    return shape.guard(row);
  });
  add('get', '/societies/:societyId/guards', { query: listQuery({ status: guardStates.optional() }) }, async ({ user, params, query }) => {
    await secretary(user, params.societyId);
    return list(db.Guard, { society: params.societyId, ...(query.status && { status: query.status }) }, query, shape.guard);
  });
  add('post', '/societies/:societyId/guards/:guardId/remove', {}, async ({ user, params }) => {
    await secretary(user, params.societyId);
    const row = await db.Guard.findOneAndUpdate({ _id: params.guardId, society: params.societyId, status: { $in: ['APPROVED', 'PENDING'] } },
      { status: 'REMOVED' }, { new: true });
    state(row, 'This Guard is not active in your society.');
    await db.Duty.updateMany({ guard: row._id, endedAt: null }, { endedAt: new Date() });
    await audit(user, params.societyId, 'GUARD_REMOVED', 'GUARD', row._id);
    await membershipChanged(row.user, 'GUARD', row._id);
    await dutyChanged(params.societyId);
    return shape.guard(row);
  });
  add('post', '/societies/:societyId/duty/start', { body: z.object({ gateIds: z.array(id).min(1).max(100) }).strict() }, async ({ user, params, body }) => {
    const worker = await guard(user, params.societyId);
    const gates = [...new Set<string>(body.gateIds)];
    state(await db.Gate.countDocuments({ _id: { $in: gates }, society: params.societyId, isActive: true }) === gates.length, 'Select active gates from this society');
    try {
      const row = await db.Duty.create({ guard: worker._id, society: params.societyId, gates, startedAt: new Date() });
      await dutyChanged(params.societyId);
      return shape.duty(row);
    } catch (error) {
      if (duplicate(error)) fail('DUTY_ALREADY_STARTED', 'End your current duty first');
      throw error;
    }
  });
  add('post', '/societies/:societyId/duty/end', {}, async ({ user, params }) => {
    const worker = await guard(user, params.societyId);
    const row = await db.Duty.findOneAndUpdate({ guard: worker._id, endedAt: null }, { endedAt: new Date() }, { new: true });
    if (!row) fail('NO_ACTIVE_DUTY', 'No duty is open');
    await dutyChanged(params.societyId);
    return shape.duty(row);
  });
  add('get', '/societies/:societyId/duty/current', {}, async ({ user, params }) => {
    const worker = await guard(user, params.societyId);
    const row = await db.Duty.findOne({ guard: worker._id, endedAt: null });
    return row ? shape.duty(row) : null;
  });
  add('get', '/societies/:societyId/duty/on-duty', { query: listQuery() }, async ({ user, params, query }) => {
    await secretary(user, params.societyId);
    const rows = await onDuty(params.societyId);
    return listed(rows.slice((query.page - 1) * query.limit, query.page * query.limit), query.page, query.limit, rows.length);
  });
}
