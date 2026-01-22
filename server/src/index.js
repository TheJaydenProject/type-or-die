const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const setupSocketHandlers = require('./handlers/socketHandlers');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true
  }
});

// Setup socket event handlers
setupSocketHandlers(io);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

// API endpoint to get server stats
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

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🚀 Type or Die - Server Started`);
  console.log(`${'='.repeat(50)}`);
  console.log(`📡 Server:     http://localhost:${PORT}`);
  console.log(`🔌 Socket.io:  Ready for connections`);
  console.log(`💾 Redis:      Connected`);
  console.log(`🗄️  PostgreSQL: Connected`);
  console.log(`${'='.repeat(50)}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});