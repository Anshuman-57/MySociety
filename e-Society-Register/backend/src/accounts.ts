import * as db from './models.js';
import { duplicate } from './core.js';

// Assignment does not verify the number or create a login session. Its owner must use OTP.
export async function accountByPhone(phone: string) {
  try {
    return await db.User.findOneAndUpdate({ phone }, { $setOnInsert: { phone, phoneVerified: false, isPlatformAdmin: false } },
      { upsert: true, new: true });
  } catch (error) {
    if (!duplicate(error)) throw error;
    const existing = await db.User.findOne({ phone });
    if (!existing) throw error;
    return existing;
  }
}
