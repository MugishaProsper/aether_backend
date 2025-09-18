import Redis from 'ioredis';
import { config } from './index.js';
import { setupLogging } from './logging.js';

const logger = setupLogging();

class RedisConnection {
  constructor() {
    this.client = null;
    this.subscriber = null;
    this.publisher = null;
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) {
      return;
    }

    try {
      const redisOptions = {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: null,
        keyPrefix: config.redis.keyPrefix,
      };

      if (config.redis.cluster) {
        // Redis Cluster configuration
        const clusterNodes = config.redis.uri.split(',').map(node => {
          const [host, port] = node.replace('redis://', '').split(':');
          return { host, port: parseInt(port, 10) || 6379 };
        });

        this.client = new Redis.Cluster(clusterNodes, {
          redisOptions,
          enableOfflineQueue: false,
        });
      } else {
        // Single Redis instance
        this.client = new Redis(config.redis.uri, redisOptions);
      }

      // Create separate connections for pub/sub
      this.subscriber = this.client.duplicate();
      this.publisher = this.client.duplicate();

      // Event handlers for main client
      this.client.on('connect', () => {
        logger.info('Redis client connected');
      });

      this.client.on('ready', () => {
        logger.info('Redis client ready');
        this.isConnected = true;
      });

      this.client.on('error', (error) => {
        logger.error('Redis client error:', error);
        this.isConnected = false;
      });

      this.client.on('close', () => {
        logger.warn('Redis client connection closed');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        logger.info('Redis client reconnecting...');
      });

      // Connect all clients
      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
        this.publisher.connect(),
      ]);

      // Load Lua scripts
      await this.loadLuaScripts();

      logger.info('All Redis connections established');
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect() {
    if (!this.isConnected) {
      return;
    }

    try {
      await Promise.all([
        this.client?.disconnect(),
        this.subscriber?.disconnect(),
        this.publisher?.disconnect(),
      ]);

      this.isConnected = false;
      logger.info('Redis connections closed');
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
      throw error;
    }
  }

  async loadLuaScripts() {
    try {
      // Inventory reservation script
      this.client.defineCommand('reserveStock', {
        numberOfKeys: 2,
        lua: `
          local stock = tonumber(redis.call("GET", KEYS[1]) or "0")
          local qty = tonumber(ARGV[1])
          if stock >= qty then
            redis.call("DECRBY", KEYS[1], qty)
            redis.call("SET", KEYS[2], qty, "EX", ARGV[2])
            return 1
          else
            return 0
          end
        `,
      });

      // Release reservation script
      this.client.defineCommand('releaseReservation', {
        numberOfKeys: 2,
        lua: `
          local reservation = redis.call("GET", KEYS[2])
          if reservation then
            redis.call("INCRBY", KEYS[1], reservation)
            redis.call("DEL", KEYS[2])
            return 1
          else
            return 0
          end
        `,
      });

      // Atomic cart update script
      this.client.defineCommand('updateCart', {
        numberOfKeys: 1,
        lua: `
          local cart = redis.call("GET", KEYS[1])
          if cart then
            redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
            return 1
          else
            redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
            return 0
          end
        `,
      });

      logger.info('Lua scripts loaded successfully');
    } catch (error) {
      logger.error('Error loading Lua scripts:', error);
      throw error;
    }
  }

  getClient() {
    return this.client;
  }

  getSubscriber() {
    return this.subscriber;
  }

  getPublisher() {
    return this.publisher;
  }

  isHealthy() {
    return this.isConnected && this.client?.status === 'ready';
  }

  // Helper methods for common operations
  async get(key) {
    return this.client.get(key);
  }

  async set(key, value, ttl = null) {
    if (ttl) {
      return this.client.set(key, value, 'EX', ttl);
    }
    return this.client.set(key, value);
  }

  async del(key) {
    return this.client.del(key);
  }

  async exists(key) {
    return this.client.exists(key);
  }

  async incr(key) {
    return this.client.incr(key);
  }

  async decr(key) {
    return this.client.decr(key);
  }

  async hget(key, field) {
    return this.client.hget(key, field);
  }

  async hset(key, field, value) {
    return this.client.hset(key, field, value);
  }

  async hgetall(key) {
    return this.client.hgetall(key);
  }

  async expire(key, seconds) {
    return this.client.expire(key, seconds);
  }

  async ttl(key) {
    return this.client.ttl(key);
  }

  // Cache helper methods
  async getJson(key) {
    const value = await this.get(key);
    return value ? JSON.parse(value) : null;
  }

  async setJson(key, value, ttl = null) {
    return this.set(key, JSON.stringify(value), ttl);
  }

  // Session management
  async getSession(sessionId) {
    return this.getJson(`session:${sessionId}`);
  }

  async setSession(sessionId, data, ttl = config.redis.ttl.session) {
    return this.setJson(`session:${sessionId}`, data, ttl);
  }

  async deleteSession(sessionId) {
    return this.del(`session:${sessionId}`);
  }
}

// Export singleton instance
const redisConnection = new RedisConnection();
export const connectRedis = redisConnection.connect.bind(redisConnection);
export const redis = redisConnection;