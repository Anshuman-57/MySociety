import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const base = process.env.VERIFY_URL || 'http://localhost:4000';
const stamp = String(Date.now()).slice(-8);
async function call(method, path, token, body, expected) {
  const response = await fetch(base + '/api/v1' + path, {
    method, headers: { ...(token && { Authorization: 'Bearer ' + token }), ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body)
  });
  const result = await response.json();
  if (expected) {
    assert.equal(response.ok, false, path);
    assert.equal(result.error?.code, expected, path);
    if (expected === 'NOT_ON_DUTY_AT_GATE' || expected === 'FORBIDDEN') assert.equal(response.status, 403, path);
    return result.error;
  }
  if (!response.ok) throw Object.assign(new Error(path + ' ' + JSON.stringify(result.error)), { status: response.status, code: result.error?.code });
  return result.data;
}
const get = (path, token) => call('GET', path, token);
const post = (path, token, body, error) => call('POST', path, token, body, error);
async function signIn(phone, firstName, dateOfBirth = '1994-05-12') {
  const result = await post('/auth/otp/verify', null, { phone, code: '123456' });
  return result.isNewUser ? post('/auth/signup', null, { signupToken: result.signupToken, firstName, dateOfBirth }) : result;
}
const adminPhone = process.env.ADMIN_PHONE || '+919100000100';
const admin = (await signIn(adminPhone, 'Admin')).accessToken;
const accounts = await Promise.all(['Secretary', 'Guard', 'Head', 'Member', 'Visitor', 'OtherSecretary', 'OtherGuard'].map((name, index) =>
  signIn('+919' + stamp + index, name)));
const [secretary, guard, head, member, visitor, otherSecretary, otherGuard] = accounts.map(account => account.accessToken);
await post('/auth/otp/request', null, { phone: accounts[4].user.phone });
async function setUpSociety(owner, worker, name) {
  const ownerProfile = await get('/me', owner);
  const details = { name, address: '12 Main Road', city: 'Ahmedabad', state: 'Gujarat', country: 'India', pincode: '380015', secretaryPhone: ownerProfile.user.phone };
  await post('/societies', owner, details, 'FORBIDDEN');
  const society = await post('/societies', admin, details);
  assert.equal(society.status, 'APPROVED');
  assert.deepEqual(await get('/societies/' + society.id + '/homes', owner), []);
  await post('/admin/societies/' + society.id + '/suspend', admin);
  await call('GET', '/societies/' + society.id + '/homes', owner, undefined, 'SOCIETY_NOT_APPROVED');
  await post('/admin/societies/' + society.id + '/activate', admin);
  assert((await get('/societies/search?q=' + encodeURIComponent(name), owner)).some(row => row.id === society.id));
  assert((await get('/societies/search?q=' + encodeURIComponent(name.toLowerCase() + ' Ahmedabad 380015'), owner)).some(row => row.id === society.id));
  assert.deepEqual(await get('/societies/search?q=%5B', owner), []);
  const firstPage = await get('/societies/search?limit=1&page=1', owner);
  assert.equal(firstPage.length, 1);
  assert.equal(typeof firstPage[0].address, 'string');
  await post('/societies', admin, details, 'INVALID_STATE');
  const path = '/societies/' + society.id;
  const gate = await post(path + '/gates', owner, { gateNumber: '1', name: 'Main gate' });
  const otherGate = await post(path + '/gates', owner, { gateNumber: '2', name: 'Side gate' });
  await post(path + '/guards/join', worker, undefined, 'FORBIDDEN');
  const workerProfile = await get('/me', worker);
  const addedGuard = await post(path + '/guards', owner, { phone: workerProfile.user.phone });
  assert.equal(addedGuard.status, 'APPROVED');
  await post(path + '/guards', owner, { phone: workerProfile.user.phone }, 'ALREADY_MEMBER');
  await post(path + '/duty/start', worker, { gateIds: [gate.id] });
  return { path, gate, otherGate, society };
}
const first = await setUpSociety(secretary, guard, 'Test Residency ' + stamp);
const second = await setUpSociety(otherSecretary, otherGuard, 'Other Residency ' + stamp);
await call('GET', first.path + '/gates', otherGuard, undefined, 'FORBIDDEN');
await call('GET', first.path + '/audit', otherSecretary, undefined, 'FORBIDDEN');
await post(first.path + '/duty/start', guard, { gateIds: [first.gate.id] }, 'DUTY_ALREADY_STARTED');
const homeDetails = { wing: 'B', flatNumber: '204', ownerPhone: accounts[2].user.phone };
for (const account of [admin, guard, head, visitor, otherSecretary]) await post(first.path + '/flats', account, homeDetails, 'FORBIDDEN');
const flat = await post(first.path + '/flats', secretary, homeDetails);
await post(first.path + '/flats', secretary, homeDetails, 'FLAT_ALREADY_EXISTS');
assert((await get('/me', head)).flats.some(row => row.flat.id === flat.id && row.member.status === 'APPROVED'));
assert.equal(flat.status, 'APPROVED');
await post('/flats/' + flat.id + '/suspend', secretary);
assert.deepEqual(await get(first.path + '/homes', visitor), []);
await post('/flats/' + flat.id + '/activate', secretary);
const homeChoices = await get(first.path + '/homes?limit=100', visitor);
assert.deepEqual(homeChoices, [{ id: flat.id, label: 'B-204', wing: 'B', flatNumber: '204' }]);
assert.deepEqual(await get(first.path + '/homes?q=204&limit=1&page=1', guard), homeChoices);
assert.deepEqual(await get(first.path + '/homes?q=missing', visitor), []);
assert.deepEqual(await get(second.path + '/homes', visitor), []);
const lookup = await post(first.path + '/flats/lookup', visitor, { wing: 'b', flatNumber: '204' });
assert.deepEqual(lookup, { flatId: flat.id, label: 'B-204' });
const application = await post('/flats/' + flat.id + '/members/join', member, { relation: 'TENANT' });
await post('/flats/' + flat.id + '/members/' + application.id + '/approve', head);
const guestType = (await get('/guest-types', visitor)).find(type => type.name === 'Friend');
assert(guestType);
console.log('PASS OTP login, direct society/Secretary/Guard/home setup, gate duty, membership and role restrictions');
function event(socket, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for ' + name)), 6000);
    socket.once(name, data => { clearTimeout(timer); resolve(data); });
  });
}
const socket = io(base, { auth: { token: head }, transports: ['websocket'], reconnection: false });
const visitorSocket = io(base, { auth: { token: visitor }, transports: ['websocket'], reconnection: false });
try {
  await Promise.all([event(socket, 'connect'), event(visitorSocket, 'connect')]);
  const created = event(socket, 'visit:created');
  const requestedNotice = event(socket, 'notification:new');
  const payload = { flatId: flat.id, guestTypeId: guestType.id, purpose: 'Demo visit' };
  const visit = await post('/visits', visitor, payload);
  const pendingPass = (await get('/visits/current', visitor)).find(row => row.id === visit.id);
  assert.equal(pendingPass.status, 'PENDING');
  assert.equal(pendingPass.qrToken, undefined);
  assert.equal((await created).id, visit.id);
  assert.equal((await requestedNotice).type, 'VISIT_REQUEST');
  const visitPath = '/visits/' + visit.id;
  const handled = event(socket, 'visit:handled');
  const visitorUpdated = event(visitorSocket, 'visit:updated');
  const decisions = await Promise.allSettled([post(visitPath + '/approve', head), post(visitPath + '/approve', member)]);
  assert.equal(decisions.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(String(decisions.find(result => result.status === 'rejected').reason), /ALREADY_HANDLED/);
  assert.equal(decisions.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal((await handled).status, 'APPROVED');
  assert.equal((await visitorUpdated).status, 'APPROVED');
  const { qrToken } = await get(visitPath, visitor);
  assert(qrToken);
  const approvedPass = (await get('/visits/current', visitor)).find(row => row.id === visit.id);
  assert.equal(approvedPass.qrToken, qrToken);
  assert.equal(approvedPass.society.name, first.society.name);
  assert(!(await get('/visits/current', member)).some(row => row.id === visit.id));
  assert.equal((await get(visitPath, guard)).respondedBy, null);
  assert.equal((await get(visitPath, guard)).qrToken, undefined);
  await post('/scans/entry', otherGuard, { qrToken, gateId: second.gate.id }, 'WRONG_SOCIETY');
  await post('/scans/entry', guard, { qrToken, gateId: first.otherGate.id }, 'NOT_ON_DUTY_AT_GATE');
  assert.equal((await get(visitPath, visitor)).status, 'APPROVED');
  const scanBody = { qrToken, gateId: first.gate.id };
  await post('/scans/exit', guard, scanBody, 'ENTRY_REQUIRED');
  assert.equal((await post('/scans/entry', guard, scanBody)).visit.status, 'CHECKED_IN');
  assert.equal((await get('/visits/current', visitor)).find(row => row.id === visit.id).qrToken, qrToken);
  await post('/scans/entry', guard, scanBody, 'QR_ALREADY_USED');
  await post('/suspicious-scans', member, { qrToken }, 'NOT_FOUND');
  await post('/suspicious-scans', otherGuard, { qrToken }, 'NOT_FOUND');
  const reliefGuard = (await signIn('+919' + stamp + '8', 'ReliefGuard')).accessToken;
  await post(first.path + '/guards', secretary, { phone: '+919' + stamp + '8' });
  await post(first.path + '/duty/end', guard);
  await post(first.path + '/duty/start', reliefGuard, { gateIds: [first.gate.id] });
  assert((await get(first.path + '/visits/inside', reliefGuard)).some(row => row.id === visit.id));
  assert.equal((await post('/scans/exit', reliefGuard, scanBody)).visit.status, 'CHECKED_OUT');
  await post(first.path + '/duty/end', reliefGuard);
  await post(first.path + '/duty/start', guard, { gateIds: [first.gate.id] });
  console.log('PASS guard shift handover: next guard sees visitors inside and records exit with the same QR');
  await post('/scans/exit', guard, scanBody, 'QR_INVALID');
  assert.equal((await get('/visits/mine?status=CHECKED_OUT', visitor))[0].id, visit.id);
  assert(!(await get('/visits/current', visitor)).some(row => row.id === visit.id));
  for (const [path, token] of [[first.path + '/visits', secretary], [first.path + '/visits', guard], ['/flats/' + flat.id + '/visits', member], ['/visits/mine', visitor], ['/admin/visits?societyId=' + first.society.id, admin]]) {
    assert((await get(path + (path.includes('?') ? '&' : '?') + 'q=Demo%20visit&status=CHECKED_OUT', token)).some(row => row.id === visit.id));
    assert.deepEqual(await get(path + (path.includes('?') ? '&' : '?') + 'q=nonexistent-' + stamp, token), []);
  }
  assert((await get(first.path + '/visits?q=' + accounts[4].user.phone.replace('+', '%2B'), secretary)).some(row => row.id === visit.id));
  assert((await get(first.path + '/visits?q=B-204', guard)).some(row => row.id === visit.id));
  const historyDay = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  assert((await get(first.path + '/visits?from=' + historyDay + '&to=' + historyDay, secretary)).some(row => row.id === visit.id));
  assert.deepEqual(await get(first.path + '/visits?q=%5B', secretary), []);
  await call('GET', '/admin/visits', visitor, undefined, 'FORBIDDEN');
  await call('GET', '/admin/audit', secretary, undefined, 'FORBIDDEN');
  await call('GET', first.path + '/visits', otherGuard, undefined, 'FORBIDDEN');
  await call('GET', first.path + '/visits?from=2026-12-31&to=2026-01-01', secretary, undefined, 'VALIDATION_ERROR');
  assert.deepEqual(await get(first.path + '/visits?from=2000-01-01&to=2000-01-02', secretary), []);
  assert((await get('/admin/audit?societyId=' + first.society.id, admin)).some(row => row.action === 'VISIT_ENTRY' && row.entityId === visit.id));
  assert((await get(first.path + '/audit', secretary)).some(row => row.action === 'VISIT_EXIT' && row.entityId === visit.id));
  const patch = (path, token, body) => call('PATCH', path, token, body);
  const membershipPath = '/flats/' + flat.id + '/members/' + application.id;
  await patch(membershipPath, head, { canApproveVisitors: false });
  assert.equal((await get(visitPath, member)).id, visit.id);
  const rejected = await post(first.path + '/walkins', guard, { ...payload, phone: '+919880000002', name: 'Rejected visitor' });
  await post('/visits/' + rejected.id + '/approve', member, undefined, 'FORBIDDEN');
  await post('/visits/' + rejected.id + '/reject', head);
  assert((await get('/notifications', guard)).some(row => row.type === 'VISIT_REJECTED' && row.data.visitId === rejected.id));
  await post('/visits/' + rejected.id + '/allow-entry', guard, { gateId: first.gate.id }, 'VISIT_NOT_APPROVED');
  assert.equal((await get('/visits/' + rejected.id, head)).qrToken, undefined);
  await patch(membershipPath, head, { canApproveVisitors: true });
  const cancelled = await post('/visits', visitor, payload);
  await post('/visits/' + cancelled.id + '/cancel', visitor);
  assert.equal((await get('/visits/' + cancelled.id, visitor)).status, 'CANCELLED');
  assert(!(await get('/visits/current', visitor)).some(row => row.id === cancelled.id));
  await post('/visits/' + cancelled.id + '/approve', head, undefined, 'ALREADY_HANDLED');
  const cab = (await get('/guest-types', visitor)).find(type => type.name === 'Cab');
  await post('/visits', visitor, { ...payload, guestTypeId: cab.id }, 'VEHICLE_REQUIRED');
  console.log('PASS searchable history, date filters, platform oversight, scan audits, read-only residents, rejected entry, cancellation and vehicle requirements');
  console.log('PASS live approval, concurrent first response, QR privacy, manual entry and exit, duplicate scans, wrong society, removed Resident verification and history');

  const walkIn = await post(first.path + '/walkins', guard, { ...payload, phone: '+919880000001', name: 'Walk-in Demo' });
  await post('/visits/' + walkIn.id + '/allow-entry', guard, { gateId: first.gate.id }, 'VISIT_NOT_APPROVED');
  await post('/visits/' + walkIn.id + '/approve', head);
  const walkPath = '/visits/' + walkIn.id;
  await post(walkPath + '/allow-entry', guard, { gateId: first.gate.id });
  assert((await get(first.path + '/visits/inside', guard)).some(row => row.id === walkIn.id));
  await post(walkPath + '/mark-exit', guard, { gateId: first.gate.id });
  assert((await get(first.path + '/walkins/suggestions?phonePrefix=91988', guard)).some(row => row.name === 'Walk-in Demo'));
  await post(first.path + '/emergency-logs', guard, { gateId: first.gate.id, type: 'AMBULANCE', note: 'Demo arrival' });
  assert.equal((await get(first.path + '/emergency-logs', secretary))[0].type, 'AMBULANCE');
  const ist = new Date(Date.now() + 330 * 60_000);
  const today = ist.toISOString().slice(0, 10);
  const pass = await post('/flats/' + flat.id + '/passes', head, { helperPhone: accounts[4].user.phone, guestTypeId: guestType.id,
    daysOfWeek: [ist.getUTCDay()], startTime: '00:00', endTime: '23:59', validFrom: today });
  assert((await get('/passes/mine', visitor)).some(row => row.id === pass.id));
  const ineligiblePass = await post('/flats/' + flat.id + '/passes', head, { helperPhone: accounts[4].user.phone, guestTypeId: guestType.id,
    daysOfWeek: [(ist.getUTCDay() + 1) % 7], startTime: '00:00', endTime: '23:59', validFrom: today });
  assert(!(await get('/visits/today-passes', visitor)).some(row => row.recurringPassId === ineligiblePass.id));
  let helperVisitId;
  if (ist.toISOString().slice(11, 16) < '23:59') {
    const helperVisit = (await get('/visits/today-passes', visitor)).find(row => row.qrToken && row.recurringPassId === pass.id);
    assert(helperVisit);
    helperVisitId = helperVisit.id;
    assert((await get('/visits/current', visitor)).some(row => row.id === helperVisit.id && row.qrToken === helperVisit.qrToken));
    assert.equal(helperVisit.status, 'APPROVED');
    const helperScan = { qrToken: helperVisit.qrToken, gateId: first.gate.id };
    assert.equal((await post('/scans/entry', guard, helperScan)).visit.status, 'CHECKED_IN');
    await post('/scans/entry', guard, helperScan, 'QR_ALREADY_USED');
    assert.equal((await post('/scans/exit', guard, helperScan)).visit.status, 'CHECKED_OUT');
  }
  if (process.env.VERIFY_LIFECYCLE === 'true') {
    const { verifyLifecycle } = await import('./verify-lifecycle.mjs');
    await verifyLifecycle({ post, get, call, signIn, stamp, first, flat, head, member, guard, visitor, payload, pass,
      scannedVisitIds: [visit.id, walkIn.id, ...(helperVisitId ? [helperVisitId] : [])] });
  }
  await post('/flats/' + flat.id + '/transfer-head', secretary, { newHeadPhone: accounts[4].user.phone });
  assert((await get('/me', visitor)).flats.some(row => row.flat.id === flat.id && row.member.role === 'HEAD'));
  assert((await get('/me', member)).flats.some(row => row.flat.id === flat.id && row.member.status === 'PENDING'));
  assert((await get(first.path + '/audit', secretary)).some(row => row.action === 'HEAD_TRANSFERRED'));
  const { verifyProvisioning } = await import('./verify-provisioning.mjs');
  await verifyProvisioning({ post, get, call, admin, visitor, stamp });
  await post('/notifications/read-all', visitor);
  assert.deepEqual(await get('/notifications?unread=true', visitor), []);
  const refreshToken = accounts[3].refreshToken;
  const rotated = await post('/auth/refresh', null, { refreshToken });
  await post('/auth/refresh', null, { refreshToken }, 'UNAUTHORIZED');
  await call('GET', '/me', rotated.accessToken, undefined, 'UNAUTHORIZED');
  console.log('PASS walk-in, suggestions, emergency log, recurring pass, headship transfer, audit, notifications and refresh rotation');
} finally {
  socket.disconnect();
  visitorSocket.disconnect();
}
