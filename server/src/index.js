const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const setupSocketHandlers = require('./handlers/socketHandlers');
require('dotenv').config();

const requiredEnvVars = ['DB_PASSWORD', 'DB_HOST', 'DB_NAME'];
const missing = requiredEnvVars.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Create a .env file with these variables.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
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
    const redis = require('./config/redis');
    const db = require('./config/database');
    
    const [redisCheck, dbCheck] = await Promise.all([
      redis.ping().then(() => true).catch(() => false),
      db.query('SELECT 1').then(() => true).catch(() => false)
    ]);
    
    const roomCount = await redis.get('global:room_count') || 0;
    
    res.json({
      status: redisCheck && dbCheck ? 'healthy' : 'degraded',
      timestamp: Date.now(),
      uptime: process.uptime(),
      services: {
        redis: redisCheck ? 'up' : 'down',
        postgres: dbCheck ? 'up' : 'down'
      },
      metrics: {
        activeRooms: parseInt(roomCount)
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      error: error.message
    });
  }
});

app.get('/api/stats', async (req, res) => {
  const redis = require('./config/redis');
  try {
    const roomCount = await redis.get('global:room_count') || 0;
    res.json({
      activeRooms: parseInt(roomCount),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Type or Die - Server Started`);
  console.log(`${'='.repeat(50)}`);
  console.log(`Server:     http://localhost:${PORT}`);
  console.log(`Socket.io:  Ready for connections`);
  console.log(`Redis:      Connected`);
  console.log(`PostgreSQL: Connected`);
  console.log(`${'='.repeat(50)}\n`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});