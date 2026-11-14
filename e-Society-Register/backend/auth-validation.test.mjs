import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

// Isolated authentication checks: no database connection, SMS, or real accounts.
Object.assign(process.env, {
  NODE_ENV: 'test', OTP_MODE: 'dev', MONGODB_URI: 'mongodb://127.0.0.1/unused',
  JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_SIGNUP_SECRET: 'b'.repeat(32), QR_SECRET: 'c'.repeat(32)
});
const { authRoutes } = await import('./src/auth.ts');
const { errorResponse, phone } = await import('./src/core.ts');
const db = await import('./src/models.ts');
const { mobileDigits, phoneSchema } = await import('../frontend/src/phone.tsx');
const { contexts, setupActions } = await import('../frontend/src/workspaces.ts');
const { errorMessage } = await import('../frontend/src/errors.ts');

test('role login errors explain why access was denied', () => {
  const message = 'Your account does not have an approved admin role. Sign in as Visitor to view or submit applications.';
  assert.equal(errorMessage('FORBIDDEN', message), message);
  assert.equal(errorMessage('FORBIDDEN'), 'You do not have permission in this workspace.');
});

test('setup actions follow the selected authorized workspace', () => {
  const me = { user: { isPlatformAdmin: true }, secretaryOf: { status: 'APPROVED' }, guardIn: [],
    flats: [{ member: { status: 'APPROVED' }, flat: { id: 'flat', status: 'APPROVED' }, society: { status: 'APPROVED' } }] };
  assert.deepEqual(setupActions(me, 'admin'), [['/society/register', 'Add society']]);
  assert.deepEqual(setupActions(me, 'secretary'), [['/home/register', 'Add home']]);
  assert.deepEqual(setupActions(me, 'visitor'), [['/home/join', 'Join existing home']]);
  assert.deepEqual(setupActions(me, 'home:flat'), [['/home/join', 'Join existing home']]);
  assert.deepEqual(setupActions(me, 'guard:society'), []);
  assert.deepEqual(setupActions(me, 'home:unrelated'), []);
  me.user.isPlatformAdmin = false;
  me.secretaryOf.status = 'SUSPENDED';
  assert.deepEqual(setupActions(me, 'admin'), []);
  assert.deepEqual(setupActions(me, 'secretary'), []);
});

test('workspace choices follow approved roles and use one Resident label', () => {
  const me = { user: { isPlatformAdmin: false }, secretaryOf: null, guardIn: [], flats: [] };
  assert.deepEqual(contexts(me).map(row => row.id), ['visitor']);
  me.secretaryOf = { id: 'society', name: 'Society', status: 'PENDING' };
  me.guardIn = [{ guard: { status: 'PENDING' }, society: { id: 'society', name: 'Society', status: 'APPROVED' } }];
  me.flats = ['HEAD', 'MEMBER'].map((role, index) => ({
    member: { role, status: 'APPROVED' }, flat: { id: String(index), label: 'A-' + index, status: 'APPROVED' },
    society: { name: 'Society', status: 'APPROVED' }
  }));
  assert.deepEqual(contexts(me).map(row => row.id), ['visitor', 'home:0', 'home:1']);
  assert.equal(contexts(me).filter(row => row.label.startsWith('Resident')).length, 2);
  me.user.isPlatformAdmin = true;
  me.secretaryOf.status = 'APPROVED';
  me.guardIn[0].guard.status = 'APPROVED';
  assert.deepEqual(contexts(me).map(row => row.id), ['visitor', 'admin', 'secretary', 'guard:society', 'home:0', 'home:1']);
  me.flats[0].member.status = 'REMOVED';
  me.flats[1].society.status = 'SUSPENDED';
  me.guardIn[0].society.status = 'SUSPENDED';
  me.secretaryOf.status = 'SUSPENDED';
  assert.deepEqual(contexts(me).map(row => row.id), ['visitor', 'admin']);
});

test('phone validation and input sanitation', () => {
  for (const schema of [phone, phoneSchema]) {
    assert.equal(schema.parse('9876543210'), '+919876543210');
    assert.equal(schema.parse('+919876543210'), '+919876543210');
    for (const invalid of ['', '987654321', '98765432101', '+9198765432101', '98765abc10', '+129876543210']) {
      assert.equal(schema.safeParse(invalid).success, false, invalid);
    }
  }
  assert.equal(mobileDigits('9876543210123'), '9876543210');
  assert.equal(mobileDigits('98a76b543210'), '9876543210');
  assert.equal(mobileDigits('+919876543210'), '9876543210');
});

test('OTP role login validates approved scopes before creating a session', async () => {
  const userId = '111111111111111111111111';
  const societyId = '222222222222222222222222';
  const flatId = '333333333333333333333333';
  let sessionCount = 0;
  let user = { _id: userId, phone: '+919876543210', firstName: 'Test', dateOfBirth: '1994-05-12', phoneVerified: true, isPlatformAdmin: false };
  let societies = [];
  let guards = [];
  let members = [];
  let flats = [];
  db.User.findOne = async () => user;
  db.Society.find = async filter => societies.filter(row => row.status === filter.status);
  db.Guard.find = async filter => guards.filter(row => row.status === filter.status);
  db.Member.find = async filter => members.filter(row => row.status === filter.status);
  db.Flat.find = async filter => flats.filter(row => row.status === filter.status && filter.society.$in.includes(row.society));
  db.Session.create = async () => { sessionCount++; return { _id: '444444444444444444444444' }; };
  db.WalkIn.updateMany = async () => ({});
  const app = express();
  app.use(express.json());
  authRoutes(app);
  app.use((error, _req, res, _next) => errorResponse(error, res));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  async function login(role, number = '9876543210', code = '123456') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/otp/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: number, code, role })
    });
    return { status: response.status, ...await response.json() };
  }
  try {
    assert.equal((await login('ADMIN')).status, 403);
    assert.equal(sessionCount, 0);
    assert.equal((await login('VISITOR', '98765432101')).status, 400);
    assert.equal((await login('INVALID')).status, 400);
    assert.equal((await login('VISITOR', '9876543210', '000000')).status, 400);
    const visitorLogin = await login('VISITOR');
    assert.equal(visitorLogin.data.workspace.id, 'visitor');
    assert.equal(visitorLogin.data.workspace.home, '/pass');
    user.isPlatformAdmin = true;
    assert.equal((await login('AUTO')).data.workspace.id, 'admin');
    societies = [{ _id: societyId, secretary: userId, status: 'APPROVED' }];
    assert.equal((await login('SECRETARY')).data.workspace.home, '/secretary');
    guards = [{ society: societyId, status: 'PENDING' }];
    assert.equal((await login('GUARD')).status, 403);
    guards[0].status = 'APPROVED';
    assert.equal((await login('GUARD')).data.workspace.id, 'guard:' + societyId);
    members = [{ flat: flatId, role: 'HEAD', status: 'APPROVED' }];
    flats = [{ _id: flatId, society: societyId, status: 'APPROVED' }];
    assert.equal((await login('RESIDENT')).data.workspace.home, '/home/' + flatId);
    members[0].role = 'MEMBER';
    assert.equal((await login('RESIDENT', '9876543211')).data.workspace.id, 'home:' + flatId);
    societies[0].status = 'SUSPENDED';
    for (const role of ['SECRETARY', 'GUARD', 'RESIDENT']) assert.equal((await login(role, '9876543211')).status, 403);
    user = null;
    assert.equal((await login('ADMIN', '9876543212')).status, 403);
    assert.equal((await login('VISITOR', '9876543212')).data.isNewUser, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
