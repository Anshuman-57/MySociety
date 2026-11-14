import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import { activityRoutes } from './activity.js';
import { authRoutes } from './auth.js';
import { authenticate, env, errorResponse, fail, rooms, setSockets } from './core.js';
import { homeRoutes } from './homes.js';
import { startJobs } from './jobs.js';
import { connect } from './models.js';
import { passRoutes } from './passes.js';
import { societyRoutes } from './societies.js';
import { visitRoutes } from './visits.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet(), cors({ origin: env.CORS_ORIGINS }), express.json({ limit: '32kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' } }) }));
authRoutes(app);
societyRoutes(app);
homeRoutes(app);
visitRoutes(app);
passRoutes(app);
activityRoutes(app);
app.use(() => fail('NOT_FOUND', 'Route not found'));
app.use(((error, _req, res, _next) => errorResponse(error, res)) satisfies express.ErrorRequestHandler);

const http = createServer(app);
const io = new Server(http, { cors: { origin: env.CORS_ORIGINS }, allowRequest: (req, callback) =>
  callback(null, !req.headers.origin || env.CORS_ORIGINS.includes(req.headers.origin)) });
setSockets(io);
io.use(async (socket, next) => {
  try {
    const { token } = socket.handshake.auth;
    const { user } = await authenticate(typeof token === 'string' ? token : undefined);
    socket.data.userId = user._id;
    next();
  } catch { next(new Error('UNAUTHORIZED')); }
});
io.on('connection', socket => {
  async function refreshRooms() {
    try {
      await authenticate(socket.handshake.auth.token);
      const next = await rooms(socket.data.userId);
      for (const room of socket.rooms) if (/^(flat|society):/.test(room) && !next.includes(room)) await socket.leave(room);
      await socket.join(next);
    } catch { socket.disconnect(true); }
  }
  void refreshRooms();
  const validate = setInterval(() => { void refreshRooms(); }, 30_000);
  socket.on('rooms:refresh', refreshRooms);
  socket.on('disconnect', () => clearInterval(validate));
});

try {
  await connect(env.MONGODB_URI);
  http.listen(env.PORT, () => console.log('MySociety API listening on port', env.PORT));
  startJobs();
} catch (error) {
  console.error('Unable to connect to MongoDB. Check MONGODB_URI and network access.', error instanceof Error ? error.name : '');
  process.exit(1);
}
