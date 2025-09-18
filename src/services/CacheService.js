import { redis } from '../config/redis.js';
import { config } from '../config/index.js';
import { recordCacheMetric } from '../config/metrics.js';
import { setupLogging } from '../config/logging.js';

const logger = setupLogging();

class CacheService {
  constructor() {
    this.defaultTTL = config.redis.ttl.cache;
    this.keyPrefix = config.redis.keyPrefix;
  }

  /**
   * Generate cache key with prefix
   */
  generateKey(type, identifier, suffix = '') {
    const key = `${type}:${identifier}${suffix ? ':' + suffix : ''}`;
    return key;
  }

  /**
   * Get cached data
   */
  async get(key, type = 'general') {
    try {
      const startTime = Date.now();
      const data = await redis.getJson(key);
      const duration = Date.now() - startTime;

      if (data !== null) {
        recordCacheMetric('hits', type);
        logger.debug(`Cache hit for key: ${key} (${duration}ms)`);
        return data;
      } else {
        recordCacheMetric('misses', type);
        logger.debug(`Cache miss for key: ${key}`);
        return null;
      }
    } catch (error) {
      logger.error(`Cache get error for key ${key}:`, error);
      recordCacheMetric('misses', type);
      return null;
    }
  }

  /**
   * Set cached data
   */
  async set(key, data, ttl = null, type = 'general') {
    try {
      const startTime = Date.now();
      const cacheTTL = ttl || this.defaultTTL;
      
      await redis.setJson(key, data, cacheTTL);
      const duration = Date.now() - startTime;
      
      logger.debug(`Cache set for key: ${key} (TTL: ${cacheTTL}s, ${duration}ms)`);
      return true;
    } catch (error) {
      logger.error(`Cache set error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete cached data
   */
  async del(key) {
    try {
      const result = await redis.del(key);
      logger.debug(`Cache delete for key: ${key} (deleted: ${result})`);
      return result > 0;
    } catch (error) {
      logger.error(`Cache delete error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async delPattern(pattern) {
    try {
      const keys = await redis.getClient().keys(pattern);
      if (keys.length === 0) {
        return 0;
      }

      const result = await redis.getClient().del(...keys);
      logger.debug(`Cache pattern delete: ${pattern} (deleted: ${result} keys)`);
      return result;
    } catch (error) {
      logger.error(`Cache pattern delete error for pattern ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    try {
      return await redis.exists(key);
    } catch (error) {
      logger.error(`Cache exists error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get TTL for a key
   */
  async ttl(key) {
    try {
      return await redis.ttl(key);
    } catch (error) {
      logger.error(`Cache TTL error for key ${key}:`, error);
      return -1;
    }
  }

  /**
   * Cache with fallback function
   */
  async getOrSet(key, fallbackFn, ttl = null, type = 'general') {
    try {
      // Try to get from cache first
      let data = await this.get(key, type);
      
      if (data !== null) {
        return data;
      }

      // Cache miss, execute fallback function
      logger.debug(`Cache miss for ${key}, executing fallback function`);
      data = await fallbackFn();
      
      // Cache the result if it's not null/undefined
      if (data !== null && data !== undefined) {
        await this.set(key, data, ttl, type);
      }
      
      return data;
    } catch (error) {
      logger.error(`Cache getOrSet error for key ${key}:`, error);
      
      // If caching fails, still try to execute fallback
      try {
        return await fallbackFn();
      } catch (fallbackError) {
        logger.error(`Fallback function error for key ${key}:`, fallbackError);
        throw fallbackError;
      }
    }
  }

  /**
   * Product caching methods
   */
  async getProduct(productId) {
    const key = this.generateKey('product', productId);
    return this.get(key, 'product');
  }

  async setProduct(productId, product, ttl = 300) { // 5 minutes default
    const key = this.generateKey('product', productId);
    return this.set(key, product, ttl, 'product');
  }

  async delProduct(productId) {
    const key = this.generateKey('product', productId);
    return this.del(key);
  }

  async getProductsByMerchant(merchantId, page = 1, filters = {}) {
    const filterKey = Object.keys(filters).sort().map(k => `${k}:${filters[k]}`).join('|');
    const key = this.generateKey('products', merchantId, `page:${page}:${filterKey}`);
    return this.get(key, 'products');
  }

  async setProductsByMerchant(merchantId, page, filters, products, ttl = 180) { // 3 minutes default
    const filterKey = Object.keys(filters).sort().map(k => `${k}:${filters[k]}`).join('|');
    const key = this.generateKey('products', merchantId, `page:${page}:${filterKey}`);
    return this.set(key, products, ttl, 'products');
  }

  async invalidateProductCache(productId, merchantId = null) {
    const tasks = [];
    
    // Invalidate single product cache
    tasks.push(this.delProduct(productId));
    
    // Invalidate merchant product lists
    if (merchantId) {
      const pattern = this.generateKey('products', merchantId, '*');
      tasks.push(this.delPattern(pattern));
    }
    
    // Invalidate search results
    tasks.push(this.delPattern(this.generateKey('search', '*')));
    
    // Invalidate featured products
    tasks.push(this.del(this.generateKey('featured', 'products')));
    
    await Promise.all(tasks);
    logger.info(`Invalidated product cache for product ${productId}`);
  }

  /**
   * User caching methods
   */
  async getUser(userId) {
    const key = this.generateKey('user', userId);
    return this.get(key, 'user');
  }

  async setUser(userId, user, ttl = 600) { // 10 minutes default
    const key = this.generateKey('user', userId);
    // Remove sensitive data before caching
    const sanitizedUser = { ...user };
    delete sanitizedUser.passwordHash;
    delete sanitizedUser.security;
    delete sanitizedUser.verification;
    
    return this.set(key, sanitizedUser, ttl, 'user');
  }

  async delUser(userId) {
    const key = this.generateKey('user', userId);
    return this.del(key);
  }

  /**
   * Cart caching methods
   */
  async getCart(cartId) {
    const key = this.generateKey('cart', cartId);
    return this.get(key, 'cart');
  }

  async setCart(cartId, cart, ttl = null) {
    const key = this.generateKey('cart', cartId);
    const cacheTTL = ttl || config.redis.ttl.cart;
    return this.set(key, cart, cacheTTL, 'cart');
  }

  async delCart(cartId) {
    const key = this.generateKey('cart', cartId);
    return this.del(key);
  }

  /**
   * Search result caching
   */
  async getSearchResults(query, filters = {}, page = 1) {
    const filterKey = Object.keys(filters).sort().map(k => `${k}:${filters[k]}`).join('|');
    const queryKey = `${query || 'all'}:${filterKey}:page:${page}`;
    const key = this.generateKey('search', queryKey);
    return this.get(key, 'search');
  }

  async setSearchResults(query, filters, page, results, ttl = 300) { // 5 minutes default
    const filterKey = Object.keys(filters).sort().map(k => `${k}:${filters[k]}`).join('|');
    const queryKey = `${query || 'all'}:${filterKey}:page:${page}`;
    const key = this.generateKey('search', queryKey);
    return this.set(key, results, ttl, 'search');
  }

  async invalidateSearchCache() {
    const pattern = this.generateKey('search', '*');
    return this.delPattern(pattern);
  }

  /**
   * Category caching
   */
  async getCategories() {
    const key = this.generateKey('categories', 'all');
    return this.get(key, 'categories');
  }

  async setCategories(categories, ttl = 3600) { // 1 hour default
    const key = this.generateKey('categories', 'all');
    return this.set(key, categories, ttl, 'categories');
  }

  async invalidateCategories() {
    const key = this.generateKey('categories', 'all');
    return this.del(key);
  }

  /**
   * Featured products caching
   */
  async getFeaturedProducts() {
    const key = this.generateKey('featured', 'products');
    return this.get(key, 'featured');
  }

  async setFeaturedProducts(products, ttl = 600) { // 10 minutes default
    const key = this.generateKey('featured', 'products');
    return this.set(key, products, ttl, 'featured');
  }

  async invalidateFeaturedProducts() {
    const key = this.generateKey('featured', 'products');
    return this.del(key);
  }

  /**
   * Sales statistics caching
   */
  async getSalesStats(merchantId, period) {
    const key = this.generateKey('sales', merchantId, period);
    return this.get(key, 'sales');
  }

  async setSalesStats(merchantId, period, stats, ttl = 1800) { // 30 minutes default
    const key = this.generateKey('sales', merchantId, period);
    return this.set(key, stats, ttl, 'sales');
  }

  async invalidateSalesStats(merchantId = null) {
    if (merchantId) {
      const pattern = this.generateKey('sales', merchantId, '*');
      return this.delPattern(pattern);
    } else {
      const pattern = this.generateKey('sales', '*');
      return this.delPattern(pattern);
    }
  }

  /**
   * Configuration caching
   */
  async getConfig(configKey) {
    const key = this.generateKey('config', configKey);
    return this.get(key, 'config');
  }

  async setConfig(configKey, configValue, ttl = 3600) { // 1 hour default
    const key = this.generateKey('config', configKey);
    return this.set(key, configValue, ttl, 'config');
  }

  async invalidateConfig(configKey = null) {
    if (configKey) {
      const key = this.generateKey('config', configKey);
      return this.del(key);
    } else {
      const pattern = this.generateKey('config', '*');
      return this.delPattern(pattern);
    }
  }

  /**
   * Session caching (handled by redis service, but included for completeness)
   */
  async getSession(sessionId) {
    return redis.getSession(sessionId);
  }

  async setSession(sessionId, sessionData, ttl = null) {
    const cacheTTL = ttl || config.redis.ttl.session;
    return redis.setSession(sessionId, sessionData, cacheTTL);
  }

  async delSession(sessionId) {
    return redis.deleteSession(sessionId);
  }

  /**
   * Bulk operations
   */
  async mget(keys) {
    try {
      const values = await redis.getClient().mget(...keys);
      return keys.map((key, index) => {
        const value = values[index];
        return value ? JSON.parse(value) : null;
      });
    } catch (error) {
      logger.error('Cache mget error:', error);
      return keys.map(() => null);
    }
  }

  async mset(keyValuePairs, ttl = null) {
    try {
      const args = [];
      const expireCommands = [];
      
      for (const [key, value] of keyValuePairs) {
        args.push(key, JSON.stringify(value));
        
        if (ttl) {
          expireCommands.push(['expire', key, ttl]);
        }
      }
      
      await redis.getClient().mset(...args);
      
      if (expireCommands.length > 0) {
        const pipeline = redis.getClient().pipeline();
        expireCommands.forEach(cmd => pipeline.expire(cmd[1], cmd[2]));
        await pipeline.exec();
      }
      
      return true;
    } catch (error) {
      logger.error('Cache mset error:', error);
      return false;
    }
  }

  /**
   * Cache warming functions
   */
  async warmProductCache(productIds) {
    const Product = (await import('../models/index.js')).Product;
    
    try {
      const products = await Product.find({ _id: { $in: productIds } });
      const keyValuePairs = products.map(product => [
        this.generateKey('product', product._id.toString()),
        product.toJSON()
      ]);
      
      await this.mset(keyValuePairs, 300); // 5 minutes TTL
      logger.info(`Warmed cache for ${products.length} products`);
    } catch (error) {
      logger.error('Error warming product cache:', error);
    }
  }

  async warmFeaturedProducts() {
    const Product = (await import('../models/index.js')).Product;
    
    try {
      const products = await Product.findFeatured(20);
      await this.setFeaturedProducts(products, 600); // 10 minutes TTL
      logger.info('Warmed featured products cache');
    } catch (error) {
      logger.error('Error warming featured products cache:', error);
    }
  }

  /**
   * Cache statistics
   */
  async getCacheStats() {
    try {
      const info = await redis.getClient().info('memory');
      const keyspace = await redis.getClient().info('keyspace');
      
      return {
        memory: this.parseRedisInfo(info),
        keyspace: this.parseRedisInfo(keyspace),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Error getting cache stats:', error);
      return null;
    }
  }

  /**
   * Parse Redis INFO command output
   */
  parseRedisInfo(info) {
    const lines = info.split('\r\n');
    const result = {};
    
    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        result[key] = isNaN(value) ? value : Number(value);
      }
    }
    
    return result;
  }

  /**
   * Flush all cache (use with caution)
   */
  async flushAll() {
    try {
      await redis.getClient().flushall();
      logger.warn('All cache flushed');
      return true;
    } catch (error) {
      logger.error('Error flushing cache:', error);
      return false;
    }
  }
}

// Export singleton instance
export default new CacheService();