import Redis from 'ioredis';
import 'dotenv/config';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  // parse int to ensure correct type, avoids subtle connection issues
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  
  // Custom strategy to prevent infinite retry loops in production
  retryStrategy: (times) => {
    const MAX_RETRIES = 20;
    if (times > MAX_RETRIES) {
      console.error(`FATAL: Redis retry limit exceeded (${MAX_RETRIES} attempts). Stopping reconnection.`);
      return null; // Returning null stops the retry process
    }
    // Exponential backoff capped at 2 seconds
    const delay = Math.min(times * 50, 2000);
    return delay;
  },

  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true;
    }
    return false;
  },

  // Fail fast on requests if Redis is down, rather than queueing indefinitely
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  keepAlive: 30000 
});

redis.on('connect', () => {
  console.log('Redis: Connected');
});

redis.on('error', (err) => {
  // Log error but do not crash; retryStrategy handles reconnection
  console.error('Redis Error:', err.message);
});

redis.on('reconnecting', () => {
  console.log('Redis: Reconnecting...');
});

export default redis;