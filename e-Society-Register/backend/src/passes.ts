import type { Express } from 'express';
import { z } from 'zod';
import * as db from './models.js';
import * as shape from './shapes.js';
import { audit, childCheck, date, duplicate, fail, get, hash, istDate, key, list, listQuery, membership, notify, phone, qr, register, state } from './core.js';
import { visitIds, visitUpdated } from './visits.js';

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const fields = z.object({ guestTypeId: z.string().regex(/^[a-f\d]{24}$/i), daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startTime: time, endTime: time, validFrom: date, validTo: date.optional() }).strict();
function validateSchedule(pass: any) {
  state(pass.startTime < pass.endTime, 'End time must follow start time on the same day');
  state(!pass.validTo || pass.validTo >= pass.validFrom, 'End date must follow the start date');
  state(new Set(pass.daysOfWeek).size === pass.daysOfWeek.length, 'Select each weekday once');
}
export async function generatePasses(passId?: string, now = new Date()) {
  const today = istDate(now);
  const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
  const passes = await db.Pass.find({ ...(passId && { _id: passId }), isActive: true, daysOfWeek: weekday,
    validFrom: { $lte: today }, $or: [{ validTo: null }, { validTo: { $gte: today } }] });
  for (const pass of passes) {
    const flat = await db.Flat.findOne({ _id: pass.flat, status: 'APPROVED' });
    if (!flat || !await db.Society.exists({ _id: flat.society, status: 'APPROVED' })) continue;
    const validUntil = new Date(today + 'T' + pass.endTime + ':00+05:30');
    if (validUntil <= now) continue;
    const row = new db.Visit({ society: flat.society, flat: flat._id, visitor: pass.helper, guestType: pass.guestType,
      purpose: 'Recurring pass', recurringPassId: pass._id, passDate: today, status: 'APPROVED',
      validFrom: new Date(today + 'T' + pass.startTime + ':00+05:30'), validUntil });
    row.qrTokenHash = hash(qr(row));
    try { await row.save(); }
    catch (error) { if (duplicate(error)) continue; throw error; }
    await visitUpdated(row);
    await notify([pass.helper], 'PASS_QR_READY', 'Today’s gate pass is ready', visitIds(row));
  }
}
export function passRoutes(app: Express) {
  const add = register.bind(null, app);
  add('get', '/passes/mine', { query: listQuery() }, ({ user, query }) => list(db.Pass, { helper: user._id }, query, row => shape.pass(row, true)));
  add('get', '/flats/:flatId/passes', { query: listQuery() }, async ({ user, params, query }) => {
    await membership(user, params.flatId);
    return list(db.Pass, { flat: params.flatId }, query, shape.pass);
  });
  add('post', '/flats/:flatId/passes', { body: fields.extend({ helperPhone: phone }) }, async ({ user, params, body }) => {
    const { flat } = await membership(user, params.flatId, 'head');
    childCheck(flat, user);
    validateSchedule(body);
    const helper = await db.User.findOne({ phone: body.helperPhone });
    if (!helper) fail('HELPER_NOT_FOUND', 'The helper must have an account');
    await get(db.GuestType, { _id: body.guestTypeId, isActive: true });
    const { guestTypeId, helperPhone, ...schedule } = body;
    const row = await db.Pass.create({ ...schedule, helper: helper._id, guestType: guestTypeId, flat: flat._id, createdBy: user._id });
    await audit(user, flat.society, 'PASS_CREATED', 'RECURRING_PASS', row._id);
    await generatePasses(key(row));
    return shape.pass(row);
  });
  add('patch', '/flats/:flatId/passes/:passId', { body: fields.partial().extend({ isActive: z.boolean().optional() }) },
    async ({ user, params, body }) => {
      const { flat } = await membership(user, params.flatId, 'head');
      const row = await get(db.Pass, { _id: params.passId, flat: flat._id });
      const { guestTypeId, ...fields } = body;
      if (guestTypeId) await get(db.GuestType, { _id: guestTypeId, isActive: true });
      row.set({ ...fields, ...(guestTypeId && { guestType: guestTypeId }) });
      validateSchedule(row);
      await row.save();
      await audit(user, flat.society, 'PASS_UPDATED', 'RECURRING_PASS', row._id);
      await generatePasses(key(row));
      return shape.pass(row);
    });
  add('delete', '/flats/:flatId/passes/:passId', {}, async ({ user, params }) => {
    const { flat } = await membership(user, params.flatId, 'head');
    const row = await get(db.Pass, { _id: params.passId, flat: flat._id });
    await row.deleteOne();
    await audit(user, flat.society, 'PASS_DELETED', 'RECURRING_PASS', row._id);
    return { ok: true };
  });
}
