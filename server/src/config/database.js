import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'type_or_die',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  // Pool Sizing: Min 5 ensures baseline readiness; Max 20 prevents connection starvation
  min: 5,
  max: 20,
  // Aggressive timeouts to prevent zombie connections holding resources
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000, 
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

// Only logs when a *new* client is created, not every query
pool.on('connect', () => {
  // In high-traffic prod, you might want to remove this log to reduce noise
  console.log('PostgreSQL: New client connected to pool');
});

// Unhandled pool errors can crash the process
pool.on('error', (err) => {
  console.error('FATAL: Unexpected error on idle client', err);
});

export const query = (text, params) => pool.query(text, params);

// Shutdown of the pool from index.js
export const end = () => pool.end();

export default {
  query,
  end,
  pool
};