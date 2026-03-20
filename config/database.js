// config/database.js
const { Pool } = require('pg');
const logger = require('../src/utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') logger.debug('DB pool client connected');
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error', { error: err.message });
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  getClient: async () => {
    const client = await pool.connect();
    const originalRelease = client.release.bind(client);
    client.release = () => { client.release = originalRelease; return originalRelease(); };
    return client;
  },
};
