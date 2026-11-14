import 'dotenv/config';

// Keep verification accounts and visits separate from the app's configured database.
const uri = new URL(process.env.MONGODB_URI);
if (!['localhost', '127.0.0.1'].includes(uri.hostname)) throw new Error('Local verification requires a local MongoDB instance');
uri.pathname = '/esociety_functional_verification';
process.env.MONGODB_URI = uri.toString();
process.env.PORT = '4001';
process.env.OTP_MODE = 'dev';
process.env.NODE_ENV = 'development';
process.env.CORS_ORIGINS = 'http://localhost:5173,http://localhost:5174';
process.env.ADMIN_PHONE = '+919100000100';
process.env.VERIFY_URL = 'http://localhost:4001';
const mode = process.argv[2];
if (mode === 'seed') {
  process.argv.push('--demo');
  await import('./dist/seed.js');
} else if (mode === 'server') {
  await import('./dist/server.js');
} else if (mode === 'verify') {
  process.env.VERIFY_LIFECYCLE = 'true';
  await import('./verify.mjs');
} else throw new Error('Use seed, server, or verify');
