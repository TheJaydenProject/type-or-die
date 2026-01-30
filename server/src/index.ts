import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';

import { ServerToClientEvents, ClientToServerEvents, SocketData } from '@typeordie/shared';
import setupSocketHandlers from './handlers/socketHandlers.js';
import redis from './config/redis.js';
import db from './config/database.js';
import roomManager from './services/roomManager.js';

// Validate critical environment variables
const requiredEnvVars = ['DB_PASSWORD', 'DB_HOST', 'DB_NAME'];
const missing = requiredEnvVars.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(cors({
  origin: CLIENT_URL,
  credentials: true
}));
app.use(express.json());

// Initialize Typed Socket.IO Server
const io = new Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(server, {
  cors: {
    origin: CLIENT_URL,
    credentials: true
  },
  maxHttpBufferSize: 1e6,
  pingTimeout: 20000,
  pingInterval: 25000,
  perMessageDeflate: false,
  transports: ['websocket', 'polling']
});

setupSocketHandlers(io);

// Health Check
app.get('/health', async (req, res) => {
  try {
    const [redisCheck, dbCheck] = await Promise.all([
      redis.ping().then(() => true).catch(() => false),
      db.query('SELECT 1').then(() => true).catch(() => false)
    ]);
    
    const metrics = await roomManager.getMetrics();
    
    if (!redisCheck || !dbCheck) {
      res.status(503).json({ status: 'degraded', redis: redisCheck, postgres: dbCheck });
      return; 
    }

    res.json({
      status: 'healthy',
      timestamp: Date.now(),
      uptime: process.uptime(),
      metrics
    });
  } catch (error) {
    console.error('Health Check Failure:', error);
    res.status(500).json({ status: 'error' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Type or Die - Server Started (TypeScript)`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Server:     http://localhost:${PORT}`);
  console.log(`Socket.io:  Ready`);
  console.log(`${'='.repeat(50)}\n`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down...');
  server.close(async () => {
    try {
      await redis.quit();
      await db.end();
    } catch (err) {
      console.error('Cleanup error:', err);
    }
    process.exit(0);
  });
});