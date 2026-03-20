const Redis = require('ioredis');
const logger = require('../utils/logger');

const redis = new Redis(process.env.REDIS_URL, {
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error:', err.message));
redis.on('reconnecting', () => logger.warn('Redis reconnecting...'));

const connectRedis = async () => {
  try {
    await redis.connect();
    await redis.ping();
    logger.info('Redis ready');
  } catch (err) {
    logger.warn('Redis unavailable, continuing without cache:', err.message);
  }
};

module.exports = { redis, connectRedis };
