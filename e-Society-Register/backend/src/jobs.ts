import cron from 'node-cron';
import * as db from './models.js';
import { approvers, key, notify } from './core.js';
import { generatePasses } from './passes.js';
import { dutyChanged } from './societies.js';
import { expirePendingVisit, responseWindow, visitIds, visitUpdated } from './visits.js';

export async function updateVisits(now = new Date()) {
  const timeout = { status: 'PENDING', requestedAt: { $lte: new Date(now.getTime() - responseWindow) } };
  for (const id of await db.Visit.find(timeout).distinct('_id')) {
    await expirePendingVisit(id, now);
  }
  const expiry = { status: 'APPROVED', validUntil: { $lt: now }, entryAt: null };
  for (const id of await db.Visit.find(expiry).distinct('_id')) {
    const row = await db.Visit.findOneAndUpdate({ _id: id, ...expiry }, { status: 'EXPIRED' }, { new: true });
    if (row) await visitUpdated(row);
  }
  const overstay = { status: 'CHECKED_IN', validUntil: { $lt: now }, overstayNotifiedAt: null };
  for (const id of await db.Visit.find(overstay).distinct('_id')) {
    const row = await db.Visit.findOneAndUpdate({ _id: id, ...overstay }, { overstayNotifiedAt: now }, { new: true });
    if (!row) continue;
    const flat = await db.Flat.findById(row.flat);
    const head = await db.Member.findOne({ flat: row.flat, role: 'HEAD', status: 'APPROVED' });
    await notify([head?.user, ...await approvers(flat)], 'VISIT_OVERSTAY', 'A visitor is past their scheduled exit', visitIds(row));
    await visitUpdated(row);
  }
}
export async function closeDuties(now = new Date()) {
  const old = { endedAt: null, startedAt: { $lte: new Date(now.getTime() - 16 * 3_600_000) } };
  for (const societyId of await db.Duty.find(old).distinct('society')) {
    await db.Duty.updateMany({ society: societyId, ...old }, { endedAt: now });
    await dutyChanged(key(societyId));
  }
}
export function startJobs() {
  const options = { timezone: 'Asia/Kolkata', noOverlap: true };
  const run = (task: () => Promise<void>) => async () => {
    try { await task(); }
    catch (error) { console.error('Scheduled job failed', error instanceof Error ? error.name : 'Unknown error'); }
  };
  cron.schedule('* * * * *', run(updateVisits), options);
  cron.schedule('*/10 * * * *', run(closeDuties), options);
  cron.schedule('5 0 * * *', run(generatePasses), options);
  void run(generatePasses)();
}
