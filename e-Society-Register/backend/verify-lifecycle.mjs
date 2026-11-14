import assert from 'node:assert/strict';

// Called only by verify-local.mjs against its named, isolated local database.
export async function verifyLifecycle({ post, get, call, signIn, stamp, first, flat, head, member, guard, visitor, payload, pass, scannedVisitIds = [] }) {
  if (new URL(process.env.MONGODB_URI).pathname !== '/esociety_functional_verification') throw new Error('Lifecycle checks require the isolated verification database');
  const db = await import('./dist/models.js');
  const mongoose = (await import('mongoose')).default;
  const { updateVisits, closeDuties } = await import('./dist/jobs.js');
  const { generatePasses } = await import('./dist/passes.js');
  await db.connect(process.env.MONGODB_URI);
  try {
    for (const visitId of scannedVisitIds) {
      assert.equal(await db.VisitScan.countDocuments({ visit: visitId, type: 'ENTRY' }), 1);
      assert.equal(await db.VisitScan.countDocuments({ visit: visitId, type: 'EXIT' }), 1);
      const record = await db.Visit.findById(visitId);
      assert.equal(Boolean(record.visitor) !== Boolean(record.walkInProfile), true);
    }
    console.log('PASS MySociety acceptance: visitor live event and QR retrieval, HTTP 409 conflicting decisions, gate 1 versus gate 2 restrictions, one entry/exit record for app visitors, walk-ins and helpers, and private B-204 lookup');
    const expired = await post('/visits', visitor, { ...payload, purpose: 'Expiry verification' });
    await post('/visits/' + expired.id + '/approve', head);
    const expiryQr = (await get('/visits/' + expired.id, visitor)).qrToken;
    await db.Visit.updateOne({ _id: expired.id }, { validUntil: new Date(Date.now() - 1000) });
    assert(!(await get('/visits/current', visitor)).some(row => row.id === expired.id));
    await updateVisits();
    const expiredDetail = await get('/visits/' + expired.id, visitor);
    assert.equal(expiredDetail.status, 'EXPIRED');
    assert.equal(expiredDetail.qrToken, undefined);
    await post('/scans/entry', guard, { qrToken: expiryQr, gateId: first.gate.id }, 'QR_EXPIRED');

    const unanswered = await post('/visits', visitor, { ...payload, purpose: 'Timeout verification' });
    await db.Visit.updateOne({ _id: unanswered.id }, { requestedAt: new Date(Date.now() - 181_000) });
    await updateVisits();
    assert.equal((await get('/visits/' + unanswered.id, visitor)).status, 'NO_RESPONSE');
    const late = await post('/visits', visitor, { ...payload, purpose: 'Deadline enforcement verification' });
    await db.Visit.updateOne({ _id: late.id }, { requestedAt: new Date(Date.now() - 181_000) });
    await post('/visits/' + late.id + '/approve', head, undefined, 'INVALID_STATE');
    const lateDetail = await get('/visits/' + late.id, visitor);
    assert.equal(lateDetail.status, 'NO_RESPONSE');
    assert.equal(lateDetail.qrToken, undefined);
    await updateVisits();
    assert.equal(await db.Notification.countDocuments({ type: 'VISIT_NO_RESPONSE', 'data.visitId': late.id }), 1);
    const unansweredWalkin = await post(first.path + '/walkins', guard, { ...payload, phone: '+919880000003', name: 'Timeout Walkin' });
    await db.Visit.updateOne({ _id: unansweredWalkin.id }, { requestedAt: new Date(Date.now() - 181_000) });
    await updateVisits();
    assert.equal((await get('/visits/' + unansweredWalkin.id, guard)).status, 'NO_RESPONSE');
    await post('/visits/' + unansweredWalkin.id + '/resend', guard);
    assert.equal((await get('/visits/' + unansweredWalkin.id, guard)).status, 'PENDING');
    await post('/visits/' + unansweredWalkin.id + '/reject', head);

    const overstayed = await post('/visits', visitor, { ...payload, purpose: 'Overstay verification' });
    await post('/visits/' + overstayed.id + '/approve', head);
    const overstayQr = (await get('/visits/' + overstayed.id, visitor)).qrToken;
    await post('/scans/entry', guard, { qrToken: overstayQr, gateId: first.gate.id });
    await db.Visit.updateOne({ _id: overstayed.id }, { validUntil: new Date(Date.now() - 1000) });
    await updateVisits();
    assert.equal((await get('/visits/' + overstayed.id, head)).isOverstayed, true);
    assert.equal((await get('/visits/current', visitor)).find(row => row.id === overstayed.id).qrToken, overstayQr);
    const overstayNotifications = await db.Notification.countDocuments({ user: (await get('/me', head)).user.id, type: 'VISIT_OVERSTAY', 'data.visitId': overstayed.id });
    assert.equal(overstayNotifications, 1);
    await updateVisits();
    assert.equal(await db.Notification.countDocuments({ user: (await get('/me', head)).user.id, type: 'VISIT_OVERSTAY', 'data.visitId': overstayed.id }), 1);
    await post('/visits/' + overstayed.id + '/extend', head, { newValidUntil: new Date(Date.now() + 3_600_000).toISOString() });
    assert.equal((await get('/visits/' + overstayed.id, visitor)).isOverstayed, false);
    await db.Visit.updateOne({ _id: overstayed.id }, { validUntil: new Date(Date.now() - 1000) });
    assert.equal((await post('/scans/exit', guard, { qrToken: overstayQr, gateId: first.gate.id })).visit.status, 'CHECKED_OUT');

    const child = await signIn('+919' + stamp + '9', 'Child', new Date(Date.now() - 10 * 365.25 * 86_400_000).toISOString().slice(0, 10));
    const childMembership = await post('/flats/' + flat.id + '/members/join', child.accessToken, { relation: 'SON' });
    await post('/flats/' + flat.id + '/members/' + childMembership.id + '/approve', head);
    await call('PATCH', '/flats/' + flat.id + '/settings', head, { childProtection: true });
    const childVisit = await post('/visits', visitor, { ...payload, purpose: 'Child protection verification' });
    await post('/visits/' + childVisit.id + '/approve', child.accessToken, undefined, 'CHILD_PROTECTION_BLOCKED');
    await post('/visits/' + childVisit.id + '/approve', head);
    await post('/flats/' + flat.id + '/members/' + childMembership.id + '/remove', head);
    await call('GET', '/flats/' + flat.id + '/visits', child.accessToken, undefined, 'FORBIDDEN');
    await call('PATCH', '/flats/' + flat.id + '/settings', head, { childProtection: false });

    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    await generatePasses(pass.id);
    await generatePasses(pass.id);
    if (new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 16) < '23:59') {
      assert.equal(await db.Visit.countDocuments({ recurringPassId: pass.id, passDate: today }), 1);
    }
    const guardProfile = await get('/me', guard);
    const worker = guardProfile.guardIn.find(row => row.society.id === first.society.id).guard;
    await db.Duty.updateOne({ guard: worker.id, endedAt: null }, { startedAt: new Date(Date.now() - 17 * 3_600_000) });
    await closeDuties();
    assert.equal(await get(first.path + '/duty/current', guard), null);
    await post(first.path + '/walkins', guard, { ...payload, phone: '+919880000004', name: 'Off-duty attempt' }, 'NO_ACTIVE_DUTY');
    assert((await get(first.path + '/visits?q=Overstay', guard)).some(row => row.id === overstayed.id));
    console.log('PASS no-response timeout, walk-in resend, QR expiry, overstay alerts, validity extension, child protection, member removal, recurring-pass idempotence and automatic duty closure');
  } finally {
    await mongoose.disconnect();
  }
}
