import type { Express } from 'express';
import { z } from 'zod';
import * as db from './models.js';
import * as shape from './shapes.js';
import { limit } from './auth.js';
import { accountByPhone } from './accounts.js';
import { allowed, audit, childCheck, duplicate, escapeRegex, fail, get, home, key, list, listQuery, memberStates, membership, membershipChanged, notify, phone, register, relations, same, secretary, serialize, society, state, states, text } from './core.js';

const address = { wing: text.max(30).transform(value => value.toUpperCase()), flatNumber: text.max(30).transform(value => value.toUpperCase()) };
export function homeRoutes(app: Express) {
  const add = register.bind(null, app);
  add('get', '/societies/:societyId/homes', { query: listQuery({ q: z.string().trim().max(60).default('') }) }, async ({ params, query }) => {
    await society(params.societyId);
    const search = new RegExp(escapeRegex(query.q), 'i');
    return list(db.Flat, { society: params.societyId, status: 'APPROVED', ...(query.q ? { $or: [{ wing: search }, { flatNumber: search }] } : {}) },
      query, flat => ({ id: key(flat), label: shape.flat(flat).label, wing: flat.wing, flatNumber: flat.flatNumber }), { wing: 1, flatNumber: 1, _id: 1 });
  });
  add('post', '/societies/:societyId/flats/lookup', { body: z.object(address).strict() }, async ({ user, params, body }) => {
    limit('lookup:' + key(user), 10, 60_000);
    await society(params.societyId);
    const flat = await db.Flat.findOne({ ...body, society: params.societyId, status: 'APPROVED' });
    if (!flat) fail('HOME_NOT_FOUND', 'Home not found. Check the wing and flat number.');
    return { flatId: key(flat), label: shape.flat(flat).label };
  });
  add('post', '/societies/:societyId/flats', { body: z.object({ ...address, ownerPhone: phone, floorNumber: z.number().int().optional() }).strict() }, async ({ user, params, body }) => {
    const property = await secretary(user, params.societyId);
    const { ownerPhone, ...details } = body;
    const owner = await accountByPhone(ownerPhone);
    let flat;
    try { flat = await db.Flat.create({ ...details, society: property._id, status: 'APPROVED' }); }
    catch (error) {
      if (duplicate(error)) fail('FLAT_ALREADY_EXISTS', 'This home is already registered');
      throw error;
    }
    try { await db.Member.create({ flat: flat._id, user: owner._id, role: 'HEAD', relation: 'SELF', status: 'APPROVED', approvedAt: new Date(), approvedBy: user._id }); }
    catch (error) { await flat.deleteOne(); throw error; }
    await audit(user, property._id, 'HOME_ADDED', 'FLAT', flat._id, { ownerUserId: key(owner) });
    await notify([owner._id], 'FLAT_ADDED', 'Your home has been added', { flatId: key(flat), societyId: key(property) });
    await membershipChanged(owner._id, 'FLAT', flat._id);
    return shape.flat(flat);
  });
  add('get', '/societies/:societyId/flats', { query: listQuery({ status: states.optional() }) }, async ({ user, params, query }) => {
    await secretary(user, params.societyId);
    return list(db.Flat, { society: params.societyId, ...(query.status && { status: query.status }) }, query, async flat => {
      const member = await db.Member.findOne({ flat: flat._id, role: 'HEAD', status: { $ne: 'REMOVED' } });
      return { flat: shape.flat(flat), head: member ? shape.user(await db.User.findById(member.user)) : null };
    });
  });
  add('get', '/flats/:flatId', {}, async ({ user, params }) => {
    const flat = await home(params.flatId, false);
    const property = await society(flat.society, false);
    if (!same(property.secretary, user)) await membership(user, flat._id);
    return shape.flat(flat);
  });
  for (const [action, status, prior] of [['activate', 'APPROVED', ['PENDING', 'REJECTED', 'SUSPENDED']],
    ['suspend', 'SUSPENDED', ['APPROVED']]] as const) {
    add('post', '/flats/:flatId/' + action, {},
      ({ user, params, body }) => serialize('flat:' + params.flatId, async () => {
        const flat = await home(params.flatId, false);
        await secretary(user, flat.society);
        state(prior.some(value => value === flat.status));
        const head = await get(db.Member, { flat: flat._id, role: 'HEAD', status: { $in: ['APPROVED', 'PENDING', 'REJECTED'] } });
        if (action !== 'suspend') await head.set({ status, approvedAt: new Date(), approvedBy: user._id }).save();
        await flat.set({ status }).save();
        await audit(user, flat.society, 'FLAT_' + status, 'FLAT', flat._id, body);
        const members = await db.Member.find({ flat: flat._id, status: { $in: ['APPROVED', 'PENDING'] } }).distinct('user');
        await Promise.all([...new Set([key(head.user), ...members.map(key)])].map(member => membershipChanged(member, 'FLAT', flat._id)));
        if (action !== 'suspend') await notify([head.user], 'FLAT_' + status, 'Home registration ' + status.toLowerCase(),
          { flatId: key(flat), societyId: key(flat.society) }, body.reason);
        return shape.flat(flat);
      }));
  }
  add('post', '/flats/:flatId/transfer-head', { body: z.object({ newHeadPhone: phone }).strict() }, ({ user, params, body }) =>
    serialize('flat:' + params.flatId, async () => {
      const flat = await home(params.flatId);
      await secretary(user, flat.society);
      const next = await accountByPhone(body.newHeadPhone);
      const old = await get(db.Member, { flat: flat._id, role: 'HEAD', status: 'APPROVED' });
      state(!same(old.user, next), 'This user is already the Head');
      const previous = await db.Member.find({ flat: flat._id, status: { $in: ['PENDING', 'APPROVED'] } });
      await old.set({ status: 'REMOVED' }).save();
      try {
        await db.Member.findOneAndUpdate({ flat: flat._id, user: next._id }, { role: 'HEAD', relation: 'SELF', status: 'APPROVED',
          canApproveVisitors: true, approvedAt: new Date(), approvedBy: user._id }, { upsert: true });
      } catch (error) { await old.set({ status: 'APPROVED' }).save(); throw error; }
      await db.Member.updateMany({ flat: flat._id, user: { $nin: [old.user, next._id] }, status: 'APPROVED' },
        { status: 'PENDING', approvedAt: null, approvedBy: null });
      await audit(user, flat.society, 'HEAD_TRANSFERRED', 'FLAT', flat._id, { previousHeadId: key(old.user), newHeadId: key(next) });
      const affected = [...new Set([...previous.map(member => key(member.user)), key(next)])];
      await Promise.all(affected.map(member => membershipChanged(member, 'FLAT', flat._id)));
      await notify(affected, 'HEAD_TRANSFERRED', 'Home headship transferred', { flatId: key(flat), societyId: key(flat.society) });
      return shape.flat(flat);
    }));
  add('patch', '/flats/:flatId/settings', { body: z.object({ childProtection: z.boolean().optional(), muteVisitorAlerts: z.boolean().optional() }).strict() },
    async ({ user, params, body }) => {
      const { flat } = await membership(user, params.flatId, 'head');
      await flat.set(body).save();
      await audit(user, flat.society, 'FLAT_SETTINGS_UPDATED', 'FLAT', flat._id, body);
      const users = await db.Member.find({ flat: flat._id, status: 'APPROVED' }).distinct('user');
      await Promise.all(users.map(target => membershipChanged(target, 'FLAT', flat._id)));
      return shape.flat(flat);
    });
  add('post', '/flats/:flatId/members/join', { body: z.object({ relation: relations }).strict() }, async ({ user, params, body }) => {
    const flat = await home(params.flatId);
    let row;
    try {
      row = await db.Member.findOneAndUpdate({ flat: flat._id, user: user._id, status: { $in: ['REJECTED', 'REMOVED'] } },
        { role: 'MEMBER', relation: body.relation, status: 'PENDING', approvedAt: null, canApproveVisitors: true }, { new: true }) ??
        await db.Member.create({ ...body, flat: flat._id, user: user._id, role: 'MEMBER', status: 'PENDING' });
    } catch (error) {
      if (duplicate(error)) fail('ALREADY_MEMBER', 'You already belong to this home or have a pending request');
      throw error;
    }
    const head = await get(db.Member, { flat: flat._id, role: 'HEAD', status: 'APPROVED' });
    await notify([head.user], 'MEMBER_JOIN_REQUEST', 'New home member request', { flatId: key(flat), memberId: key(row) });
    return shape.member(row);
  });
  add('get', '/flats/:flatId/members', { query: listQuery({ status: memberStates.optional() }) }, async ({ user, params, query }) => {
    const { member } = await membership(user, params.flatId);
    if (member.role !== 'HEAD') allowed(!query.status || query.status === 'APPROVED');
    const status = member.role === 'HEAD' ? query.status : 'APPROVED';
    return list(db.Member, { flat: params.flatId, ...(status && { status }) }, query, shape.member);
  });
  for (const [action, status] of [['approve', 'APPROVED'], ['reject', 'REJECTED'], ['remove', 'REMOVED'], ['permissions', null]] as const) {
    add(status ? 'post' : 'patch', '/flats/:flatId/members/:memberId' + (status ? '/' + action : ''),
      { body: status ? undefined : z.object({ canApproveVisitors: z.boolean() }).strict() }, ({ user, params, body }) =>
        serialize('flat:' + params.flatId, async () => {
          const { flat } = await membership(user, params.flatId, 'head');
          if (action === 'approve') childCheck(flat, user);
          const row = await get(db.Member, { flat: flat._id, _id: params.memberId });
          allowed(row.role === 'MEMBER');
          state(action === 'remove' ? ['APPROVED', 'PENDING'].includes(row.status) : status ? row.status === 'PENDING' : row.status === 'APPROVED');
          await row.set(status ? { status, ...(status === 'APPROVED' && { approvedAt: new Date(), approvedBy: user._id }) } : body).save();
          const event = status ? 'MEMBER_' + status : 'MEMBER_PERMISSIONS_UPDATED';
          await audit(user, flat.society, event, 'FLAT_MEMBER', row._id, body);
          await membershipChanged(row.user, 'FLAT', flat._id);
          if (action === 'approve' || action === 'remove') await notify([row.user], event, 'Home membership ' + status?.toLowerCase(), { flatId: key(flat), memberId: key(row) });
          return shape.member(row);
        }));
  }
}
