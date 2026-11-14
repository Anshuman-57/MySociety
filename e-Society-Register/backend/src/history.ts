import { z } from 'zod';
import * as db from './models.js';
import { date, escapeRegex, id, listQuery, visitStates } from './core.js';

export const historyQuery = (admin = false) => listQuery().extend({ status: visitStates.optional(),
  q: z.string().trim().max(100).default(''), from: date.optional(), to: date.optional(),
  ...(admin ? { societyId: id.optional() } : {})
}).refine(query => !query.from || !query.to || query.from <= query.to, 'Start date must be on or before end date');

export async function historyFilter(query: { status?: string; q?: string; from?: string; to?: string }) {
  const filter: Record<string, unknown> = { ...(query.status && { status: query.status }) };
  if (query.from || query.to) filter.createdAt = {
    ...(query.from && { $gte: new Date(query.from + 'T00:00:00+05:30') }),
    ...(query.to && { $lt: new Date(new Date(query.to + 'T00:00:00+05:30').getTime() + 86_400_000) })
  };
  if (query.q) {
    const search = new RegExp(escapeRegex(query.q), 'i');
    const [users, profiles, homes, types] = await Promise.all([
      db.User.find({ $or: [{ firstName: search }, { lastName: search }, { phone: search },
        { $expr: { $regexMatch: { input: { $concat: ['$firstName', ' ', { $ifNull: ['$lastName', ''] }] }, regex: search } } }] }).distinct('_id'),
      db.WalkIn.find({ $or: [{ name: search }, { phone: search }] }).distinct('_id'),
      db.Flat.find({ $or: [{ wing: search }, { flatNumber: search },
        { $expr: { $regexMatch: { input: { $concat: ['$wing', '-', '$flatNumber'] }, regex: search } } }] }).distinct('_id'),
      db.GuestType.find({ name: search }).distinct('_id')
    ]);
    filter.$or = [{ purpose: search }, { vehicleNumber: search }, { 'visitorSnapshot.name': search },
      { 'visitorSnapshot.phone': search }, { visitor: { $in: users } }, { walkInProfile: { $in: profiles } },
      { flat: { $in: homes } }, { guestType: { $in: types } }];
  }
  return filter;
}
