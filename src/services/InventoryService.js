import fs from 'fs';
import path from 'path';
import { redis } from '../config/redis.js';
import { config } from '../config/index.js';
import { recordInventoryMetric } from '../config/metrics.js';
import { setupLogging } from '../config/logging.js';

const logger = setupLogging();

class InventoryService {
  constructor() {
    this.scripts = {};
    this.loadLuaScripts();
  }

  async loadLuaScripts() {
    try {
      const scriptsDir = path.join(process.cwd(), 'scripts');
      
      // Load reserve stock script
      const reserveScript = fs.readFileSync(path.join(scriptsDir, 'reserve-stock.lua'), 'utf8');
      this.scripts.reserve = await redis.getClient().script('LOAD', reserveScript);
      
      // Load release reservation script
      const releaseScript = fs.readFileSync(path.join(scriptsDir, 'release-reservation.lua'), 'utf8');
      this.scripts.release = await redis.getClient().script('LOAD', releaseScript);
      
      // Load commit reservation script
      const commitScript = fs.readFileSync(path.join(scriptsDir, 'commit-reservation.lua'), 'utf8');
      this.scripts.commit = await redis.getClient().script('LOAD', commitScript);
      
      // Load batch reserve script
      const batchReserveScript = fs.readFileSync(path.join(scriptsDir, 'batch-reserve-stock.lua'), 'utf8');
      this.scripts.batchReserve = await redis.getClient().script('LOAD', batchReserveScript);
      
      logger.info('Inventory Lua scripts loaded successfully');
    } catch (error) {
      logger.error('Error loading inventory Lua scripts:', error);
      throw error;
    }
  }

  /**
   * Initialize stock level for a SKU
   */
  async initializeStock(sku, quantity) {
    const stockKey = this.getStockKey(sku);
    await redis.set(stockKey, quantity.toString());
    
    recordInventoryMetric('stock', {
      sku,
      stock: quantity,
      merchantId: this.extractMerchantFromSku(sku),
    });
    
    logger.info(`Initialized stock for SKU ${sku}: ${quantity}`);
    return quantity;
  }

  /**
   * Get current stock level for a SKU
   */
  async getStock(sku) {
    const stockKey = this.getStockKey(sku);
    const stock = await redis.get(stockKey);
    return parseInt(stock || '0', 10);
  }

  /**
   * Update stock level (increment/decrement)
   */
  async updateStock(sku, quantity, operation = 'set') {
    const stockKey = this.getStockKey(sku);
    let newStock;

    switch (operation) {
      case 'increment':
        newStock = await redis.getClient().incrby(stockKey, quantity);
        break;
      case 'decrement':
        newStock = await redis.getClient().decrby(stockKey, quantity);
        break;
      default:
        await redis.set(stockKey, quantity.toString());
        newStock = quantity;
    }

    recordInventoryMetric('stock', {
      sku,
      stock: newStock,
      merchantId: this.extractMerchantFromSku(sku),
    });

    logger.info(`Updated stock for SKU ${sku}: ${newStock} (${operation} ${quantity})`);
    return newStock;
  }

  /**
   * Reserve stock for an order
   */
  async reserveStock(orderId, sku, quantity, ttlSeconds = config.redis.ttl.reservation) {
    const stockKey = this.getStockKey(sku);
    const reservationKey = this.getReservationKey(orderId, sku);

    try {
      const result = await redis.getClient().evalsha(
        this.scripts.reserve,
        2,
        stockKey,
        reservationKey,
        quantity.toString(),
        ttlSeconds.toString()
      );

      const [success, remainingStock] = result;
      
      recordInventoryMetric('reservation', {
        status: success ? 'success' : 'failed',
      });

      if (success) {
        logger.info(`Reserved ${quantity} units of SKU ${sku} for order ${orderId}. Remaining stock: ${remainingStock}`);
        return {
          success: true,
          reservedQuantity: quantity,
          remainingStock,
          reservationKey,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        };
      } else {
        logger.warn(`Failed to reserve ${quantity} units of SKU ${sku} for order ${orderId}. Available stock: ${remainingStock}`);
        return {
          success: false,
          availableStock: remainingStock,
          requestedQuantity: quantity,
        };
      }
    } catch (error) {
      logger.error(`Error reserving stock for SKU ${sku}:`, error);
      recordInventoryMetric('reservation', { status: 'error' });
      throw error;
    }
  }

  /**
   * Release a stock reservation
   */
  async releaseReservation(orderId, sku) {
    const stockKey = this.getStockKey(sku);
    const reservationKey = this.getReservationKey(orderId, sku);

    try {
      const result = await redis.getClient().evalsha(
        this.scripts.release,
        2,
        stockKey,
        reservationKey
      );

      const [success, releasedQuantity, newStock] = result;

      if (success) {
        logger.info(`Released reservation of ${releasedQuantity} units for SKU ${sku} from order ${orderId}. New stock: ${newStock}`);
        
        recordInventoryMetric('stock', {
          sku,
          stock: newStock,
          merchantId: this.extractMerchantFromSku(sku),
        });

        return {
          success: true,
          releasedQuantity,
          newStock,
        };
      } else {
        logger.warn(`No reservation found for SKU ${sku} in order ${orderId}`);
        return {
          success: false,
          currentStock: newStock,
        };
      }
    } catch (error) {
      logger.error(`Error releasing reservation for SKU ${sku}:`, error);
      throw error;
    }
  }

  /**
   * Commit a reservation (finalize the sale)
   */
  async commitReservation(orderId, sku) {
    const stockKey = this.getStockKey(sku);
    const reservationKey = this.getReservationKey(orderId, sku);

    try {
      const result = await redis.getClient().evalsha(
        this.scripts.commit,
        2,
        stockKey,
        reservationKey
      );

      const [success, committedQuantity, remainingStock] = result;

      if (success) {
        logger.info(`Committed reservation of ${committedQuantity} units for SKU ${sku} from order ${orderId}. Remaining stock: ${remainingStock}`);
        
        recordInventoryMetric('stock', {
          sku,
          stock: remainingStock,
          merchantId: this.extractMerchantFromSku(sku),
        });

        return {
          success: true,
          committedQuantity,
          remainingStock,
        };
      } else {
        logger.warn(`No reservation found to commit for SKU ${sku} in order ${orderId}`);
        return {
          success: false,
          currentStock: remainingStock,
        };
      }
    } catch (error) {
      logger.error(`Error committing reservation for SKU ${sku}:`, error);
      throw error;
    }
  }

  /**
   * Batch reserve stock for multiple items
   */
  async batchReserveStock(orderId, items, ttlSeconds = config.redis.ttl.reservation) {
    const keys = [];
    const args = [];

    // Prepare keys and arguments for the batch script
    for (const item of items) {
      keys.push(this.getStockKey(item.sku));
      keys.push(this.getReservationKey(orderId, item.sku));
      args.push(item.quantity.toString());
      args.push(ttlSeconds.toString());
    }

    try {
      const result = await redis.getClient().evalsha(
        this.scripts.batchReserve,
        keys.length,
        ...keys,
        ...args
      );

      const [allSuccess, results] = result;
      
      const reservationResults = results.map(([stockKey, success, available, requested]) => {
        const sku = this.extractSkuFromStockKey(stockKey);
        return {
          sku,
          success: success === 1,
          availableStock: available,
          requestedQuantity: requested,
        };
      });

      recordInventoryMetric('reservation', {
        status: allSuccess ? 'success' : 'failed',
      });

      if (allSuccess) {
        logger.info(`Successfully reserved stock for all items in order ${orderId}`);
        return {
          success: true,
          reservations: reservationResults,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        };
      } else {
        logger.warn(`Failed to reserve stock for some items in order ${orderId}`);
        return {
          success: false,
          reservations: reservationResults,
        };
      }
    } catch (error) {
      logger.error(`Error batch reserving stock for order ${orderId}:`, error);
      recordInventoryMetric('reservation', { status: 'error' });
      throw error;
    }
  }

  /**
   * Release all reservations for an order
   */
  async releaseOrderReservations(orderId, skus) {
    const results = [];
    
    for (const sku of skus) {
      try {
        const result = await this.releaseReservation(orderId, sku);
        results.push({ sku, ...result });
      } catch (error) {
        logger.error(`Error releasing reservation for SKU ${sku} in order ${orderId}:`, error);
        results.push({ sku, success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * Commit all reservations for an order
   */
  async commitOrderReservations(orderId, skus) {
    const results = [];
    
    for (const sku of skus) {
      try {
        const result = await this.commitReservation(orderId, sku);
        results.push({ sku, ...result });
      } catch (error) {
        logger.error(`Error committing reservation for SKU ${sku} in order ${orderId}:`, error);
        results.push({ sku, success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * Get all active reservations for an order
   */
  async getOrderReservations(orderId) {
    const pattern = this.getReservationKey(orderId, '*');
    const keys = await redis.getClient().keys(pattern);
    
    const reservations = [];
    for (const key of keys) {
      const quantity = await redis.get(key);
      const ttl = await redis.getClient().ttl(key);
      const sku = this.extractSkuFromReservationKey(key);
      
      reservations.push({
        sku,
        quantity: parseInt(quantity, 10),
        ttl,
        expiresAt: new Date(Date.now() + ttl * 1000),
      });
    }

    return reservations;
  }

  /**
   * Check if a reservation exists
   */
  async hasReservation(orderId, sku) {
    const reservationKey = this.getReservationKey(orderId, sku);
    return await redis.exists(reservationKey);
  }

  /**
   * Get reservation details
   */
  async getReservation(orderId, sku) {
    const reservationKey = this.getReservationKey(orderId, sku);
    const quantity = await redis.get(reservationKey);
    
    if (!quantity) {
      return null;
    }

    const ttl = await redis.getClient().ttl(reservationKey);
    
    return {
      sku,
      quantity: parseInt(quantity, 10),
      ttl,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  /**
   * Cleanup expired reservations (called by background job)
   */
  async cleanupExpiredReservations() {
    const pattern = 'reservation:*';
    const keys = await redis.getClient().keys(pattern);
    
    let cleanedCount = 0;
    for (const key of keys) {
      const ttl = await redis.getClient().ttl(key);
      if (ttl <= 0) {
        await redis.del(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} expired reservations`);
    }

    return cleanedCount;
  }

  // Helper methods
  getStockKey(sku) {
    return `stock:sku:${sku}`;
  }

  getReservationKey(orderId, sku) {
    return `reservation:${orderId}:${sku}`;
  }

  extractSkuFromStockKey(stockKey) {
    return stockKey.replace('stock:sku:', '');
  }

  extractSkuFromReservationKey(reservationKey) {
    const parts = reservationKey.split(':');
    return parts[parts.length - 1];
  }

  extractMerchantFromSku(sku) {
    // Assuming SKU format includes merchant ID (e.g., MERCHANT_PRODUCT_VARIANT)
    const parts = sku.split('_');
    return parts[0] || 'unknown';
  }
}

// Export singleton instance
export default new InventoryService();