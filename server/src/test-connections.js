// Production-level connection testing utility
// Usage: node server/src/test-connections.js
// Validates Redis, PostgreSQL, and server startup before deployment

import Redis from 'ioredis';
import pg from 'pg';
import express from 'express';
import http from 'http';

// Destructure Pool from the default export to ensure CJS/ESM interop
const { Pool } = pg;

console.log('Testing connections...\n');

async function testRedis() {
  console.log('Testing Redis...');
  const redis = new Redis({
    host: 'localhost',
    port: 6379,
    retryStrategy: (times) => {
      // Stop retrying after 3 attempts to prevent hanging tests
      if (times > 3) return null;
      return Math.min(times * 50, 2000);
    }
  });

  return new Promise((resolve) => {
    redis.on('connect', async () => {
      console.log('Redis connected');
      
      try {
        // Validate write/read permissions
        await redis.set('test:key', 'Connection test');
        const value = await redis.get('test:key');
        console.log(`  Read test: "${value}"`);
        
        await redis.del('test:key');
        redis.disconnect();
        resolve(true);
      } catch (err) {
        console.log('Redis operation failed:', err.message);
        redis.disconnect();
        resolve(false);
      }
    });

    redis.on('error', (err) => {
      // Suppress full stack trace for connection errors, just show message
      console.log('Redis error:', err.message);
      resolve(false);
    });

    // Hard timeout if the event listeners never fire
    setTimeout(() => {
      console.log('Redis connection timeout');
      redis.disconnect();
      resolve(false);
    }, 5000);
  });
}

async function testPostgres() {
  console.log('\nTesting PostgreSQL...');
  
  const pool = new Pool({
    host: 'localhost',
    port: 5433,
    database: 'type_or_die',
    user: 'postgres',
    password: 'postgres',
    connectionTimeoutMillis: 5000,
  });

  try {
    // Simple query to validate auth and DB existence
    const result = await pool.query('SELECT NOW()');
    console.log('PostgreSQL connected');
    console.log(`  Server time: ${result.rows[0].now}`);
    
    await pool.end();
    return true;
  } catch (err) {
    console.log('PostgreSQL error:', err.message);
    return false;
  }
}

async function testServer() {
  console.log('\nTesting Server...');
  
  try {
    const app = express();
    const server = http.createServer(app);
    
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });
    
    await new Promise((resolve, reject) => {
      server.listen(3000, () => {
        console.log('Server can start on port 3000');
        server.close(resolve);
      });
      
      server.on('error', (err) => {
        // EADDRINUSE is acceptable if the dev server is already running
        if (err.code === 'EADDRINUSE') {
          console.log('Port 3000 is in use (OK if server is running)');
          resolve();
        } else {
          reject(err);
        }
      });
    });
    
    return true;
  } catch (err) {
    console.log('Server error:', err.message);
    return false;
  }
}

async function runTests() {
  const redisOk = await testRedis();
  const pgOk = await testPostgres();
  const serverOk = await testServer();
  
  console.log('\nTest Results:');
  console.log('----------------------------------------');
  console.log(`Redis:      ${redisOk ? 'PASS' : 'FAIL'}`);
  console.log(`PostgreSQL: ${pgOk ? 'PASS' : 'FAIL'}`);
  console.log(`Server:     ${serverOk ? 'PASS' : 'FAIL'}`);
  console.log('----------------------------------------');
  
  if (redisOk && pgOk && serverOk) {
    console.log('\nAll systems operational');
    console.log('\nNext steps:');
    console.log('1. Run: npm run dev:all');
    console.log('2. Open: http://localhost:5173');
    console.log('3. Check server logs for Socket.io connection');
  } else {
    console.log('\nSome tests failed. Check errors above.');
    console.log('\nTroubleshooting:');
    if (!redisOk) console.log('- Redis: Verify Docker container is running (docker ps)');
    if (!pgOk) console.log('- PostgreSQL: Check Docker logs (docker logs type-or-die-postgres-1)');
    if (!serverOk) console.log('- Server: Verify port 3000 is available');
  }
  
  process.exit(0);
}

runTests().catch(console.error);