import assert from 'node:assert/strict';

export async function verifyProvisioning({ post, get, call, admin, visitor, stamp }) {
  const secretaryPhone = '+918' + stamp + '0';
  const ownerPhone = '+918' + stamp + '1';
  const guardPhone = '+918' + stamp + '2';
  const replacementPhone = '+918' + stamp + '3';
  const society = await post('/societies', admin, { name: 'Direct setup ' + stamp, address: '20 Test Road',
    city: 'Ahmedabad', state: 'Gujarat', country: 'India', pincode: '380015', secretaryPhone: secretaryPhone.slice(3) });
  assert.equal(society.status, 'APPROVED');
  async function firstLogin(phone, role) {
    const verification = await post('/auth/otp/verify', null, { phone, code: '123456', role });
    assert.equal(verification.isNewUser, true);
    assert.equal(verification.accessToken, undefined);
    const tokens = await post('/auth/signup', null, { signupToken: verification.signupToken, firstName: 'Assigned ' + role, dateOfBirth: '1994-05-12' });
    assert.equal(tokens.user.phone, phone);
    return tokens;
  }
  const secretary = await firstLogin(secretaryPhone, 'SECRETARY');
  assert.equal(secretary.workspace.id, 'secretary');
  assert.equal((await get('/me', secretary.accessToken)).secretaryOf.id, society.id);
  const base = '/societies/' + society.id;
  const flat = await post(base + '/flats', secretary.accessToken, { wing: 'C', flatNumber: '303', ownerPhone: ownerPhone.slice(3) });
  assert.equal(flat.status, 'APPROVED');
  const owner = await firstLogin(ownerPhone, 'RESIDENT');
  assert.equal(owner.workspace.id, 'home:' + flat.id);
  assert.equal((await get('/me', owner.accessToken)).flats[0].member.status, 'APPROVED');
  const added = await post(base + '/guards', secretary.accessToken, { phone: guardPhone.slice(3) });
  assert.equal(added.status, 'APPROVED');
  for (const token of [visitor, owner.accessToken, admin]) await post(base + '/guards', token, { phone: guardPhone }, 'FORBIDDEN');
  await post(base + '/guards/join', visitor, undefined, 'FORBIDDEN');
  await post('/auth/otp/verify', null, { phone: guardPhone, code: '000000', role: 'GUARD' }, 'OTP_INVALID');
  const guard = await firstLogin(guardPhone, 'GUARD');
  assert.equal(guard.workspace.id, 'guard:' + society.id);
  const gate = await post(base + '/gates', secretary.accessToken, { gateNumber: '1' });
  await post(base + '/duty/start', guard.accessToken, { gateIds: [gate.id] });
  assert((await get(base + '/duty/current', guard.accessToken)).gates.some(row => row.id === gate.id));
  await call('PATCH', '/admin/societies/' + society.id + '/secretary', secretary.accessToken, { phone: replacementPhone }, 'FORBIDDEN');
  await call('PATCH', '/admin/societies/' + society.id + '/secretary', admin, { phone: replacementPhone });
  const replacement = await firstLogin(replacementPhone, 'SECRETARY');
  assert.equal(replacement.workspace.id, 'secretary');
  await call('GET', base + '/gates', secretary.accessToken, undefined, 'FORBIDDEN');
  const returning = await post('/auth/otp/verify', null, { phone: replacementPhone, code: '123456', role: 'SECRETARY' });
  assert.equal(returning.isNewUser, false);
  assert.equal(returning.workspace.id, 'secretary');
  await post('/admin/societies/' + society.id + '/suspend', admin);
  await call('GET', base + '/gates', guard.accessToken, undefined, 'SOCIETY_NOT_APPROVED');
  await post('/admin/societies/' + society.id + '/activate', admin);
  assert.equal(await get(base + '/duty/current', guard.accessToken), null);
  await post(base + '/duty/start', guard.accessToken, { gateIds: [gate.id] });
  await post(base + '/guards/' + added.id + '/remove', replacement.accessToken);
  await call('GET', base + '/duty/current', guard.accessToken, undefined, 'FORBIDDEN');
  console.log('PASS mobile-only direct setup without prior accounts or approvals, OTP/profile completion preserving assigned roles, Secretary reassignment, Guard scope and removal');
}
