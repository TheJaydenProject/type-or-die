import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';

import setupSocketHandlers from './handlers/socketHandlers.js';
import redis from './config/redis.js';
import db from './config/database.js';
import roomManager from './services/roomManager.js';

// Validate critical environment variables before booting
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

const io = new Server(server, {
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

app.get('/health', async (req, res) => {
  try {
    // Parallelize checks to minimize latency
    const [redisCheck, dbCheck] = await Promise.all([
      redis.ping().then(() => true).catch(() => false),
      db.query('SELECT 1').then(() => true).catch(() => false)
    ]);
    
    // Redis values come back as strings, must parse safely
    const rawRoomCount = await redis.get('global:room_count');
    const roomCount = rawRoomCount ? parseInt(rawRoomCount, 10) : 0;
    
    const isHealthy = redisCheck && dbCheck;

    if (!isHealthy) {
        // Return 503 Service Unavailable if dependencies are down
        return res.status(503).json({
            status: 'degraded',
            services: {
                redis: redisCheck ? 'up' : 'down',
                postgres: dbCheck ? 'up' : 'down'
            }
        });
    }

    res.json({
      status: 'healthy',
      timestamp: Date.now(),
      uptime: process.uptime(),
      services: { redis: 'up', postgres: 'up' },
      metrics: { activeRooms: roomCount }
    });
  } catch (error) {
    console.error('Health Check Failure:', error);
    res.status(500).json({
      status: 'error',
      error: 'Internal Health Check Failure'
    });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const rawRoomCount = await redis.get('global:room_count');
    res.json({
      activeRooms: rawRoomCount ? parseInt(rawRoomCount, 10) : 0,
      uptime: process.uptime()
    });
  } catch (error) {
    console.error('Stats Error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.get('/api/metrics', async (req, res) => {
  try {
    const metrics = await roomManager.getMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('Metrics Error:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Type or Die - Server Started`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Server:     http://localhost:${PORT}`);
  console.log(`Socket.io:  Ready`);
  console.log(`${'='.repeat(50)}\n`);
});

// Shutdown for preventing data loss in Redis/DB
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Starting graceful shutdown...');
  
  server.close(async () => {
    console.log('HTTP/Socket server closed.');
    
    try {
        // Close DB connections if the drivers support it
        // Assuming standard interface for redis/pg
        if (typeof redis.quit === 'function') await redis.quit();
        if (typeof db.end === 'function') await db.end();
        console.log('Database connections closed.');
    } catch (err) {
        console.error('Error during database cleanup:', err);
    }
    
    process.exit(0);
  });
});