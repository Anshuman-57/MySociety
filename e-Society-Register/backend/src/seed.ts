import mongoose from 'mongoose';
import { z } from 'zod';
import { dob, env, phone } from './core.js';
import * as db from './models.js';

const admin = z.object({ ADMIN_PHONE: phone, ADMIN_FIRST_NAME: z.string().min(1).default('Admin'),
  ADMIN_DOB: dob.default('1990-01-01') }).parse(process.env);
const types = [['Family guest', 240, false], ['Friend', 240, false], ['Delivery', 30, false], ['Cab', 20, true],
  ['Service', 180, false], ['House help', 480, false], ['Other', 60, false]] as const;
await db.connect(env.MONGODB_URI);
try {
  await db.User.updateOne({ phone: admin.ADMIN_PHONE }, { $set: { isPlatformAdmin: true, phoneVerified: true },
    $setOnInsert: { firstName: admin.ADMIN_FIRST_NAME, dateOfBirth: admin.ADMIN_DOB } }, { upsert: true });
  for (const [name, defaultValidMinutes, requiresVehicleNumber] of types) {
    await db.GuestType.updateOne({ name }, { $setOnInsert: { name, defaultValidMinutes, requiresVehicleNumber, isActive: true } }, { upsert: true });
  }
  if (process.argv.includes('--demo')) {
    if (env.OTP_MODE !== 'dev') throw new Error('Demo users require OTP_MODE=dev');
    const [secretary, guard, head, member, visitor] = await Promise.all(['Secretary', 'Guard', 'Head', 'Member', 'Visitor'].map((firstName, i) =>
      db.User.findOneAndUpdate({ phone: '+91910000010' + (i + 1) },
        { $setOnInsert: { firstName, dateOfBirth: '1994-01-01', phoneVerified: true } }, { upsert: true, new: true })));
    const society = await db.Society.findOneAndUpdate({ secretary: secretary!._id }, { $setOnInsert: {
      name: 'Greenwood Residency', address: '12 Garden Road', city: 'Ahmedabad', state: 'Gujarat', country: 'India', pincode: '380015', status: 'APPROVED'
    } }, { upsert: true, new: true });
    await db.Gate.updateOne({ society: society!._id, gateNumber: '1' }, { $setOnInsert: { name: 'Main gate', isActive: true } }, { upsert: true });
    await db.Guard.updateOne({ society: society!._id, user: guard!._id }, { $setOnInsert: { status: 'APPROVED', approvedAt: new Date() } }, { upsert: true });
    const flat = await db.Flat.findOneAndUpdate({ society: society!._id, wing: 'A', flatNumber: '101' },
      { $setOnInsert: { floorNumber: 1, status: 'APPROVED' } }, { upsert: true, new: true });
    for (const [user, role, relation] of [[head, 'HEAD', 'SELF'], [member, 'MEMBER', 'SPOUSE']] as const) {
      await db.Member.updateOne({ flat: flat!._id, user: user!._id }, { $setOnInsert: { role, relation, status: 'APPROVED', approvedAt: new Date() } }, { upsert: true });
    }
    console.log('Demo ready: Greenwood Residency, A-101. Visitor account:', visitor!.phone);
  }
  console.log('Platform admin and guest types ready.');
} finally { await mongoose.disconnect(); }
