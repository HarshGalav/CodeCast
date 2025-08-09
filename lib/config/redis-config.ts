import Redis from 'ioredis';
import { config } from '@/lib/config';

// Redis connection instance
let redisClient: Redis | null = null;

/**
 * Get or create Redis connection
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      lazyConnect: true,
      // Connection pool settings
      family: 4,
      keepAlive: true,
      // Error handling
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        return err.message.includes(targetError);
      },
    });

    // Error handling
    redisClient.on('error', (error) => {
      console.error('Redis connection error:', error);
    });

    redisClient.on('connect', () => {
      console.log('Redis connected successfully');
    });

    redisClient.on('ready', () => {
      console.log('Redis ready for operations');
    });

    redisClient.on('close', () => {
      console.log('Redis connection closed');
    });
  }

  return redisClient;
}

/**
 * Close Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

/**
 * Health check for Redis connection
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const result = await client.ping();
    return result === 'PONG';
  } catch (error) {
    console.error('Redis health check failed:', error);
    return false;
  }
}

/**
 * Redis configuration for Bull Queue
 */
export const redisConfig = {
  redis: {
    port: parseInt(config.redis.url.split(':')[2] || '6379'),
    host: config.redis.url.split('://')[1].split(':')[0] || 'localhost',
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
  },
};