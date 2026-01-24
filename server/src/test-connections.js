// Save this as: server/src/test-connections.js
// Run with: node server/src/test-connections.js

const Redis = require('ioredis');
const { Pool } = require('pg');

console.log('🧪 Testing connections...\n');

// Test Redis
async function testRedis() {
  console.log('📍 Testing Redis...');
  const redis = new Redis({
    host: 'localhost',
    port: 6379, // Your mapped port
    retryStrategy: (times) => {
      if (times > 3) return null;
      return Math.min(times * 50, 2000);
    }
  });

  return new Promise((resolve) => {
    redis.on('connect', async () => {
      console.log('✅ Redis connected!');
      
      // Test write/read
      await redis.set('test:key', 'Hello from Redis!');
      const value = await redis.get('test:key');
      console.log(`   Read test: "${value}"`);
      
      await redis.del('test:key');
      redis.disconnect();
      resolve(true);
    });

    redis.on('error', (err) => {
      console.log('❌ Redis error:', err.message);
      resolve(false);
    });

    setTimeout(() => {
      console.log('⏱️  Redis connection timeout');
      redis.disconnect();
      resolve(false);
    }, 5000);
  });
}

// Test PostgreSQL
async function testPostgres() {
  console.log('\n📍 Testing PostgreSQL...');
  
  const pool = new Pool({
    host: 'localhost',
    port: 5433, // Your mapped port
    database: 'type_or_die',
    user: 'postgres',
    password: 'postgres',
    connectionTimeoutMillis: 5000,
  });

  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL connected!');
    console.log(`   Server time: ${result.rows[0].now}`);
    
    await pool.end();
    return true;
  } catch (err) {
    console.log('❌ PostgreSQL error:', err.message);
    return false;
  }
}

// Test server startup
async function testServer() {
  console.log('\n📍 Testing Server...');
  
  try {
    const express = require('express');
    const http = require('http');
    
    const app = express();
    const server = http.createServer(app);
    
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });
    
    await new Promise((resolve, reject) => {
      server.listen(3000, () => {
        console.log('✅ Server can start on port 3000!');
        server.close(resolve);
      });
      
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log('⚠️  Port 3000 is in use (this is OK if your server is running)');
          resolve();
        } else {
          reject(err);
        }
      });
    });
    
    return true;
  } catch (err) {
    console.log('❌ Server error:', err.message);
    return false;
  }
}

// Run all tests
async function runTests() {
  const redisOk = await testRedis();
  const pgOk = await testPostgres();
  const serverOk = await testServer();
  
  console.log('\n📊 Test Results:');
  console.log('─'.repeat(40));
  console.log(`Redis:      ${redisOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`PostgreSQL: ${pgOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Server:     ${serverOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log('─'.repeat(40));
  
  if (redisOk && pgOk && serverOk) {
    console.log('\n🎉 All systems ready! You can proceed to Step 14.');
    console.log('\nNext steps:');
    console.log('1. Run: npm run dev:all');
    console.log('2. Open: http://localhost:5173');
    console.log('3. Check server logs for Socket.io connection');
  } else {
    console.log('\n⚠️  Some tests failed. Check the errors above.');
    console.log('\nTroubleshooting:');
    if (!redisOk) console.log('- Redis: Make sure Docker container is running (docker ps)');
    if (!pgOk) console.log('- PostgreSQL: Check Docker logs (docker logs type-or-die-postgres-1)');
    if (!serverOk) console.log('- Server: Check if port 3000 is available');
  }
  
  process.exit(0);
}

runTests().catch(console.error);