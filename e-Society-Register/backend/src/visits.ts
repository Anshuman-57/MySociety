import type { Express } from 'express';
import { z } from 'zod';
import * as db from './models.js';
import * as shape from './shapes.js';
import { limit } from './auth.js';
import { historyFilter, historyQuery } from './history.js';
import { allowed, approvers, audit, duty, emit, fail, get, guard, hash, home, httpUrl, id, instant, istDate, key, list, listed, listQuery, membership, notify, phone, qr, readQr, register, same, secretary, serialize, society, state, text } from './core.js';

const visitFields = { flatId: id, guestTypeId: id, purpose: text, vehicleNumber: text.max(30).optional() };
const gateBody = z.object({ gateId: id }).strict();
const scanBody = gateBody.extend({ qrToken: text });
const statusQuery = historyQuery();
export const responseWindow = 180_000;

export async function visitUpdated(row: any) {
  const safe = await shape.visit(row);
  emit('society:' + key(row.society), 'visit:updated', safe);
  if (row.visitor) emit('user:' + key(row.visitor), 'visit:updated', safe);
  emit('flat:' + key(row.flat), 'visit:updated', await shape.visit(row, { resident: true }));
}
async function alertRequest(visit: any, flat: any) {
  emit('flat:' + key(flat), 'visit:created', await shape.visit(visit, { resident: true }));
  if (!flat.muteVisitorAlerts) await notify(await approvers(flat), visit.walkInProfile ? 'WALKIN_REQUEST' : 'VISIT_REQUEST',
    'Visit request for ' + shape.flat(flat).label, visitIds(visit));
}
export const visitIds = (visit: any) => ({ visitId: key(visit), flatId: key(visit.flat), societyId: key(visit.society) });
export async function expirePendingVisit(visitId: any, now = new Date()) {
  const row = await db.Visit.findOneAndUpdate({ _id: visitId, status: 'PENDING',
    requestedAt: { $lte: new Date(now.getTime() - responseWindow) } }, { status: 'NO_RESPONSE', noResponseAt: now }, { new: true });
  if (!row) return null;
  const worker = row.createdByGuard ? await db.Guard.findById(row.createdByGuard) : null;
  await notify([row.visitor ?? worker?.user], 'VISIT_NO_RESPONSE', 'Home did not respond in time', visitIds(row));
  await visitUpdated(row);
  return row;
}
async function guest(body: { guestTypeId: string; vehicleNumber?: string }) {
  const type = await get(db.GuestType, { _id: body.guestTypeId, isActive: true });
  if (type.requiresVehicleNumber && !body.vehicleNumber) fail('VEHICLE_REQUIRED', 'Enter a vehicle number for this guest type');
  return type;
}
async function visitorFilter(user: any) {
  const linked = await db.WalkIn.find({ linkedUser: user._id }).distinct('_id');
  return { $or: [{ visitor: user._id }, { walkInProfile: { $in: linked } }] };
}
async function guardOrSecretary(user: any, societyId: string) {
  const property = await society(societyId);
  if (same(property.secretary, user)) return { secretary: true };
  return { guardId: (await guard(user, property._id))._id };
}

async function scan(user: any, original: any, gateId: string, type: 'ENTRY' | 'EXIT', isWalkIn: boolean) {
  const gate = await db.Gate.findById(gateId);
  if (!gate) fail('NOT_ON_DUTY_AT_GATE', 'Select a gate on your duty');
  const { worker } = await duty(user, gate.society, gate._id);
  if (!same(gate.society, original.society)) fail('WRONG_SOCIETY', 'This visit belongs to another society');
  await home(original.flat);
  return serialize('scan:' + key(original), async () => {
    const row = await get(db.Visit, { _id: original._id });
    const now = new Date();
    const entry = type === 'ENTRY';
    const walkInState = isWalkIn ? 'VISIT_NOT_APPROVED' : 'QR_INVALID';
    if (row.status === 'CHECKED_OUT') fail(walkInState, 'This visit is already checked out');
    if (entry) {
      if (row.status === 'CHECKED_IN') fail('QR_ALREADY_USED', 'Entry has already been recorded');
      if (isWalkIn && row.status !== 'APPROVED') fail('VISIT_NOT_APPROVED', 'Wait for home approval');
      if (row.status !== 'APPROVED' || row.validFrom > now || row.validUntil < now) fail('QR_EXPIRED', 'The entry window is closed');
    } else if (row.status !== 'CHECKED_IN') fail('ENTRY_REQUIRED', 'Record entry before exit');
    const timeField = entry ? 'entryAt' : 'exitAt';
    const status = entry ? 'CHECKED_IN' : 'CHECKED_OUT';
    const transition = { _id: row._id, status: row.status, ...(entry && { validFrom: { $lte: now }, validUntil: { $gte: now } }) };
    const updated = await db.Visit.findOneAndUpdate(transition, { status, [timeField]: now }, { new: true });
    if (!updated) fail(entry ? 'QR_EXPIRED' : walkInState, 'Visit state changed. Scan again.');
    try { await db.VisitScan.create({ visit: row._id, gate: gate._id, guard: worker._id, type, scannedAt: now }); }
    catch (error) {
      await db.Visit.updateOne({ _id: row._id, status, [timeField]: now }, { status: row.status, $unset: { [timeField]: 1 } });
      throw error;
    }
    await audit(user, row.society, 'VISIT_' + type, 'VISIT', row._id, { gateId: key(gate), guardId: key(worker), scannedAt: now });
    await visitUpdated(updated);
    return shape.visit(updated, { guardId: worker._id });
  });
}
export function visitRoutes(app: Express) {
  const add = register.bind(null, app);
  add('post', '/visits', { body: z.object(visitFields).strict() }, async ({ body, user }) => {
    const flat = await home(body.flatId);
    const type = await guest(body);
    const visit = await db.Visit.create({ society: flat.society, flat: flat._id, guestType: type._id, purpose: body.purpose,
      vehicleNumber: body.vehicleNumber, visitor: user._id, status: 'PENDING', requestedAt: new Date() });
    await alertRequest(visit, flat);
    return shape.visit(visit);
  });
  add('get', '/visits/mine', { query: statusQuery }, async ({ user, query }) =>
    list(db.Visit, { $and: [await visitorFilter(user), await historyFilter(query)] }, query, row => shape.visit(row)));
  add('get', '/visits/current', { query: listQuery() }, async ({ user, query }) => {
    const properties = await db.Society.find({ status: 'APPROVED' }).select('name');
    const flats = await db.Flat.find({ society: { $in: properties.map(property => property._id) }, status: 'APPROVED' }).distinct('_id');
    return list(db.Visit, { visitor: user._id, flat: { $in: flats }, $or: [
      { status: 'PENDING' }, { status: 'APPROVED', validUntil: { $gt: new Date() } }, { status: 'CHECKED_IN' }
    ] }, query, async row => ({ ...await shape.visit(row, { visitorId: user._id }, true),
      society: { id: key(row.society), name: properties.find(property => same(property, row.society))?.name ?? '' } }));
  });
  add('get', '/admin/visits', { query: historyQuery(true) }, async ({ user, query }) => {
    allowed(user.isPlatformAdmin);
    return list(db.Visit, { ...(query.societyId && { society: query.societyId }), ...await historyFilter(query) },
      query, row => shape.visit(row, { secretary: true }));
  });
  add('get', '/visits/today-passes', { query: listQuery() }, async ({ user, query }) => {
    return list(db.Visit, { visitor: user._id, passDate: istDate(), status: { $in: ['APPROVED', 'CHECKED_IN'] } },
      query, row => shape.visit(row, { visitorId: user._id }, true));
  });
  add('get', '/visits/:visitId', {}, async ({ params, user }) => {
    const visit = await get(db.Visit, { _id: params.visitId });
    const walkin = visit.walkInProfile ? await db.WalkIn.findById(visit.walkInProfile) : null;
    if (same(visit.visitor, user) || same(walkin?.linkedUser, user)) return shape.visit(visit, { visitorId: user._id }, true);
    const property = await society(visit.society);
    if (same(property.secretary, user)) return shape.visit(visit, { secretary: true });
    const member = await db.Member.findOne({ user: user._id, flat: visit.flat, status: 'APPROVED' });
    if (member && (await home(visit.flat)).status === 'APPROVED') return shape.visit(visit, { resident: true });
    return shape.visit(visit, { guardId: (await guard(user, visit.society))._id });
  });
  add('get', '/flats/:flatId/visits', { query: statusQuery }, async ({ user, params, query }) => {
    await membership(user, params.flatId);
    return list(db.Visit, { flat: params.flatId, ...await historyFilter(query) }, query, row => shape.visit(row, { resident: true }));
  });
  add('get', '/societies/:societyId/visits', { query: statusQuery }, async ({ user, params, query }) => {
    const viewer = await guardOrSecretary(user, params.societyId);
    return list(db.Visit, { society: params.societyId, ...await historyFilter(query) }, query, row => shape.visit(row, viewer));
  });
  add('get', '/societies/:societyId/visits/inside', { query: listQuery() }, async ({ user, params, query }) => {
    const viewer = await guardOrSecretary(user, params.societyId);
    return list(db.Visit, { society: params.societyId, status: 'CHECKED_IN' }, query, row => shape.visit(row, viewer));
  });
  add('post', '/visits/:visitId/cancel', {}, async ({ user, params }) => {
    const visit = await get(db.Visit, { _id: params.visitId });
    allowed(same(visit.visitor, user));
    const row = await db.Visit.findOneAndUpdate({ _id: visit._id, status: { $in: ['PENDING', 'APPROVED'] } },
      { status: 'CANCELLED', cancelledAt: new Date() }, { new: true });
    state(row, 'This request can no longer be cancelled');
    await visitUpdated(row);
    return shape.visit(row);
  });
  for (const action of ['approve', 'reject'] as const) {
    add('post', '/visits/:visitId/' + action, {}, async ({ user, params }) => {
      const visit = await get(db.Visit, { _id: params.visitId });
      const { flat } = await membership(user, visit.flat, 'approve');
      const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
      const now = new Date();
      if (visit.status === 'NO_RESPONSE' || await expirePendingVisit(visit._id, now)) {
        fail('INVALID_STATE', 'The three-minute response window has ended. A guard can resend a timed-out walk-in request.');
      }
      const type = await db.GuestType.findById(visit.guestType);
      const changes = { status, respondedBy: user._id, respondedAt: now,
        ...(action === 'approve' && { validFrom: now, validUntil: new Date(now.getTime() + type.defaultValidMinutes * 60_000),
          ...(visit.visitor && { qrTokenHash: hash(qr(visit)) }) }) };
      const row = await db.Visit.findOneAndUpdate({ _id: visit._id, status: 'PENDING',
        requestedAt: { $gt: new Date(now.getTime() - responseWindow) } }, changes, { new: true });
      if (!row) {
        const handled = await db.Visit.findById(visit._id);
        const responder = handled.respondedBy ? await db.User.findById(handled.respondedBy) : null;
        fail('ALREADY_HANDLED', 'This request has already been handled', { respondedBy: responder ? shape.person(responder) : null, respondedAt: handled.respondedAt ?? null });
      }
      await audit(user, flat.society, 'VISIT_' + status, 'VISIT', row._id);
      emit('flat:' + key(flat), 'visit:handled', { visitId: key(row), respondedBy: shape.person(user), respondedAt: now, status });
      await visitUpdated(row);
      const worker = row.createdByGuard ? await db.Guard.findById(row.createdByGuard) : null;
      await notify([row.visitor ?? worker?.user], 'VISIT_' + status, 'Visit ' + status.toLowerCase(), visitIds(row));
      await notify((await approvers(flat)).filter(target => !same(target, user)), 'VISIT_HANDLED', 'Visit request handled', visitIds(row));
      return shape.visit(row, { resident: true });
    });
  }
  add('post', '/visits/:visitId/extend', { body: z.object({ newValidUntil: instant }).strict() }, async ({ user, params, body }) => {
    const visit = await get(db.Visit, { _id: params.visitId });
    await membership(user, visit.flat, 'approve');
    state(visit.validUntil && body.newValidUntil > visit.validUntil && body.newValidUntil > new Date(), 'Choose a later validity time');
    const row = await db.Visit.findOneAndUpdate({ _id: visit._id, status: { $in: ['APPROVED', 'CHECKED_IN'] }, validUntil: visit.validUntil },
      { validUntil: body.newValidUntil, overstayNotifiedAt: null }, { new: true });
    state(row);
    const extension = { oldValidUntil: visit.validUntil, newValidUntil: body.newValidUntil };
    await db.Extension.create({ visit: row._id, extendedBy: user._id, ...extension });
    await audit(user, row.society, 'VISIT_EXTENDED', 'VISIT', row._id, extension);
    await visitUpdated(row);
    return shape.visit(row, { resident: true });
  });
  for (const [action, type] of [['entry', 'ENTRY'], ['exit', 'EXIT']] as const) {
    add('post', '/scans/' + action, { body: scanBody }, async ({ user, body }) => {
      const gate = await db.Gate.findById(body.gateId);
      if (!gate) fail('NOT_ON_DUTY_AT_GATE', 'Select a gate on your duty');
      await duty(user, gate.society, gate._id);
      return { result: 'OK', visit: await scan(user, await readQr(body.qrToken), body.gateId, type, false) };
    });
  }
  add('get', '/societies/:societyId/walkins/suggestions', { query: z.object({ phonePrefix: z.string().regex(/^\+?\d{4,15}$/) }).strict() }, async ({ user, params, query }) => {
    await duty(user, params.societyId);
    limit('walkin:' + key(user), 30, 60_000);
    const prefix = query.phonePrefix.replace(/^\+/, '');
    const rows = await db.WalkIn.find({ society: params.societyId, phone: new RegExp('^\\+' + prefix) }).limit(5);
    return listed(rows.map(shape.walkin), 1, 5);
  });
  add('post', '/societies/:societyId/walkins', { body: z.object({ ...visitFields, phone, name: text, photoUrl: httpUrl.optional() }).strict() },
    async ({ user, params, body }) => {
      const { worker } = await duty(user, params.societyId);
      const flat = await home(body.flatId);
      allowed(same(flat.society, params.societyId));
      const type = await guest(body);
      const filter = { society: flat.society, phone: body.phone };
      const profile = await serialize('walkin:' + params.societyId + ':' + body.phone, async () => {
        const previous = await db.WalkIn.findOne(filter);
        const linked = await db.User.findOne({ phone: body.phone, phoneVerified: true });
        const row = await db.WalkIn.findOneAndUpdate(filter, {
          name: body.name, ...(body.photoUrl && { photoUrl: body.photoUrl }), $setOnInsert: { linkedUser: linked?._id }
        }, { upsert: true, new: true });
        if (previous && (previous.name !== row.name || previous.photoUrl !== row.photoUrl)) {
          await audit(user, flat.society, 'WALKIN_PROFILE_UPDATED', 'WALKIN', row._id, { nameChanged: previous.name !== row.name, photoChanged: previous.photoUrl !== row.photoUrl });
        }
        return row;
      });
      const visit = await db.Visit.create({ society: flat.society, flat: flat._id, guestType: type._id, purpose: body.purpose,
        vehicleNumber: body.vehicleNumber, walkInProfile: profile._id, createdByGuard: worker._id,
        visitorSnapshot: { name: profile.name, phone: profile.phone, photoUrl: profile.photoUrl }, status: 'PENDING', requestedAt: new Date() });
      await alertRequest(visit, flat);
      return shape.visit(visit, { guardId: worker._id });
    });
  add('post', '/visits/:visitId/resend', {}, async ({ user, params }) => {
    const visit = await get(db.Visit, { _id: params.visitId });
    const { worker } = await duty(user, visit.society);
    allowed(visit.walkInProfile);
    const flat = await home(visit.flat);
    const row = await db.Visit.findOneAndUpdate({ _id: visit._id, status: { $in: ['PENDING', 'NO_RESPONSE'] } },
      { status: 'PENDING', requestedAt: new Date(), noResponseAt: null }, { new: true });
    state(row);
    await alertRequest(row, flat);
    await visitUpdated(row);
    return shape.visit(row, { guardId: worker._id });
  });
  for (const [action, type] of [['allow-entry', 'ENTRY'], ['mark-exit', 'EXIT']] as const) {
    add('post', '/visits/:visitId/' + action, { body: gateBody }, async ({ user, params, body }) => {
      const visit = await get(db.Visit, { _id: params.visitId });
      allowed(visit.walkInProfile);
      return scan(user, visit, body.gateId, type, true);
    });
  }
}
