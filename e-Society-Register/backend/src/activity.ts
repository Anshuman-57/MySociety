import type { Express } from 'express';
import { z } from 'zod';
import * as db from './models.js';
import * as shape from './shapes.js';
import { allowed, duty, emergencyTypes, get, guard, id, list, listQuery, notification, register, same, secretary, society, text } from './core.js';

export function activityRoutes(app: Express) {
  const add = register.bind(null, app);
  add('get', '/admin/audit', { query: listQuery({ societyId: id.optional() }) }, ({ user, query }) => {
    allowed(user.isPlatformAdmin);
    return list(db.Audit, query.societyId ? { society: query.societyId } : {}, query, shape.audit);
  });
  add('get', '/notifications', { query: listQuery({ unread: z.enum(['true', 'false']).optional() }) }, ({ user, query }) =>
    list(db.Notification, { user: user._id, ...(query.unread === 'true' && { readAt: null }) }, query, notification));
  add('post', '/notifications/read-all', {}, async ({ user }) => {
    await db.Notification.updateMany({ user: user._id, readAt: null }, { readAt: new Date() });
    return { ok: true };
  });
  add('post', '/notifications/:id/read', {}, async ({ user, params }) => {
    const row = await get(db.Notification, { _id: params.id, user: user._id });
    if (!row.readAt) await row.set({ readAt: new Date() }).save();
    return notification(row);
  });
  add('get', '/societies/:societyId/audit', { query: listQuery() }, async ({ user, params, query }) => {
    await secretary(user, params.societyId, false);
    return list(db.Audit, { society: params.societyId }, query, shape.audit);
  });
  add('get', '/societies/:societyId/emergency-logs', { query: listQuery() }, async ({ user, params, query }) => {
    const property = await society(params.societyId);
    if (!same(property.secretary, user)) await guard(user, property._id);
    return list(db.Emergency, { society: property._id }, query, shape.emergency);
  });
  add('post', '/societies/:societyId/emergency-logs', { body: z.object({
    gateId: id, type: emergencyTypes, vehicleNumber: text.max(30).optional(), note: text.optional()
  }).strict() }, async ({ user, params, body }) => {
    const { worker } = await duty(user, params.societyId, body.gateId);
    return shape.emergency(await db.Emergency.create({ society: params.societyId, gate: body.gateId, guard: worker._id,
      type: body.type, vehicleNumber: body.vehicleNumber, note: body.note }));
  });
}
