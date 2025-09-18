import { setupLogging } from '../../config/logging.js';
import { Product, User } from '../../models/index.js';
import InventoryService from '../../services/InventoryService.js';

const logger = setupLogging();

export const processInventoryJob = async (job) => {
  const { type, data } = job.data;
  
  try {
    logger.info(`Processing inventory job: ${type}`, { jobId: job.id });
    
    switch (type) {
      case 'syncInventory':
        return await syncInventory(data);
      case 'checkLowStock':
        return await checkLowStock(data);
      case 'updateStockFromProduct':
        return await updateStockFromProduct(data);
      case 'cleanupExpiredReservations':
        return await cleanupExpiredReservations(data);
      case 'reconcileInventory':
        return await reconcileInventory(data);
      default:
        throw new Error(`Unknown inventory processing type: ${type}`);
    }
    
  } catch (error) {
    logger.error(`Inventory job failed: ${type}`, {
      jobId: job.id,
      error: error.message,
      data,
    });
    
    throw error;
  }
};

async function syncInventory(data) {
  const { productId } = data;
  
  try {
    const product = await Product.findById(productId);
    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    let syncedCount = 0;
    const results = [];

    for (const variant of product.variants) {
      if (!variant.isActive) continue;

      try {
        // Initialize stock in Redis if not exists
        const currentStock = await InventoryService.getStock(variant.sku);
        
        if (currentStock === 0 && variant.stock > 0) {
          await InventoryService.initializeStock(variant.sku, variant.stock);
          syncedCount++;
          results.push({
            sku: variant.sku,
            status: 'initialized',
            stock: variant.stock,
          });
        } else if (currentStock !== variant.stock) {
          await InventoryService.updateStock(variant.sku, variant.stock, 'set');
          syncedCount++;
          results.push({
            sku: variant.sku,
            status: 'updated',
            oldStock: currentStock,
            newStock: variant.stock,
          });
        } else {
          results.push({
            sku: variant.sku,
            status: 'in_sync',
            stock: variant.stock,
          });
        }
      } catch (error) {
        logger.error(`Error syncing inventory for SKU ${variant.sku}:`, error);
        results.push({
          sku: variant.sku,
          status: 'error',
          error: error.message,
        });
      }
    }

    logger.info(`Inventory synced for product`, {
      productId,
      syncedCount,
      totalVariants: product.variants.length,
    });

    return {
      success: true,
      productId,
      syncedCount,
      results,
    };

  } catch (error) {
    logger.error(`Error syncing inventory:`, error);
    throw error;
  }
}

async function checkLowStock(data) {
  const { merchantId, threshold = 10 } = data;
  
  try {
    const query = { status: 'active' };
    if (merchantId) {
      query.merchantId = merchantId;
    }

    const products = await Product.find(query);
    const lowStockItems = [];
    const alerts = [];

    for (const product of products) {
      for (const variant of product.variants) {
        if (!variant.isActive) continue;

        const currentStock = await InventoryService.getStock(variant.sku);
        
        if (currentStock <= threshold && currentStock > 0) {
          lowStockItems.push({
            productId: product._id,
            sku: variant.sku,
            title: product.title,
            currentStock,
            threshold,
            merchantId: product.merchantId,
          });

          // Send alert to merchant
          const merchant = await User.findOne({ 
            merchantId: product.merchantId, 
            role: 'seller' 
          });

          if (merchant) {
            const { EmailService } = await import('./email.js');
            await EmailService.sendLowStockAlert(
              merchant,
              product,
              variant.sku,
              currentStock,
              threshold
            );

            alerts.push({
              merchantId: product.merchantId,
              merchantEmail: merchant.email,
              sku: variant.sku,
              currentStock,
            });
          }
        }
      }
    }

    logger.info(`Low stock check completed`, {
      merchantId,
      threshold,
      lowStockItems: lowStockItems.length,
      alertsSent: alerts.length,
    });

    return {
      success: true,
      merchantId,
      threshold,
      lowStockItems,
      alertsSent: alerts.length,
    };

  } catch (error) {
    logger.error(`Error checking low stock:`, error);
    throw error;
  }
}

async function updateStockFromProduct(data) {
  const { productId, updates } = data;
  
  try {
    const product = await Product.findById(productId);
    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    const updateResults = [];

    for (const update of updates) {
      const { sku, stock, operation = 'set' } = update;
      
      try {
        const newStock = await InventoryService.updateStock(sku, stock, operation);
        
        // Update product variant stock to match
        const variant = product.getVariantBySku(sku);
        if (variant) {
          variant.stock = newStock;
        }
        
        updateResults.push({
          sku,
          status: 'success',
          newStock,
          operation,
        });
        
      } catch (error) {
        logger.error(`Error updating stock for SKU ${sku}:`, error);
        updateResults.push({
          sku,
          status: 'error',
          error: error.message,
        });
      }
    }

    // Save product with updated variant stocks
    await product.save();

    logger.info(`Stock updated from product`, {
      productId,
      updatesProcessed: updates.length,
      successful: updateResults.filter(r => r.status === 'success').length,
    });

    return {
      success: true,
      productId,
      updates: updateResults,
    };

  } catch (error) {
    logger.error(`Error updating stock from product:`, error);
    throw error;
  }
}

async function cleanupExpiredReservations(data) {
  try {
    const cleanedCount = await InventoryService.cleanupExpiredReservations();

    logger.info(`Expired reservations cleaned up`, { cleanedCount });

    return {
      success: true,
      cleanedCount,
    };

  } catch (error) {
    logger.error(`Error cleaning up expired reservations:`, error);
    throw error;
  }
}

async function reconcileInventory(data) {
  const { merchantId } = data;
  
  try {
    const query = { status: 'active' };
    if (merchantId) {
      query.merchantId = merchantId;
    }

    const products = await Product.find(query);
    const discrepancies = [];
    let reconciledCount = 0;

    for (const product of products) {
      for (const variant of product.variants) {
        if (!variant.isActive) continue;

        const redisStock = await InventoryService.getStock(variant.sku);
        const mongoStock = variant.stock;

        if (redisStock !== mongoStock) {
          discrepancies.push({
            productId: product._id,
            sku: variant.sku,
            title: product.title,
            redisStock,
            mongoStock,
            difference: redisStock - mongoStock,
          });

          // Reconcile by updating Redis with MongoDB value (assuming MongoDB is source of truth)
          await InventoryService.updateStock(variant.sku, mongoStock, 'set');
          reconciledCount++;
        }
      }
    }

    logger.info(`Inventory reconciliation completed`, {
      merchantId,
      productsChecked: products.length,
      discrepancies: discrepancies.length,
      reconciledCount,
    });

    return {
      success: true,
      merchantId,
      productsChecked: products.length,
      discrepancies,
      reconciledCount,
    };

  } catch (error) {
    logger.error(`Error reconciling inventory:`, error);
    throw error;
  }
}

// Inventory service utility functions
export const InventoryJobService = {
  async syncInventory(productId) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addInventoryJob('syncInventory', { productId });
  },

  async checkLowStock(merchantId = null, threshold = 10) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addInventoryJob('checkLowStock', { merchantId, threshold });
  },

  async updateStockFromProduct(productId, updates) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addInventoryJob('updateStockFromProduct', { productId, updates });
  },

  async scheduleReservationCleanup() {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addInventoryJob('cleanupExpiredReservations', {});
  },

  async reconcileInventory(merchantId = null) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addInventoryJob('reconcileInventory', { merchantId });
  },

  // Recurring jobs setup
  async setupRecurringJobs() {
    const { JobScheduler } = await import('../index.js');
    
    // Check low stock daily at 9 AM
    await JobScheduler.addRecurringJob(
      'inventory',
      'checkLowStock',
      { threshold: 10 },
      '0 9 * * *' // Daily at 9 AM
    );

    // Clean up expired reservations every hour
    await JobScheduler.addRecurringJob(
      'inventory',
      'cleanupExpiredReservations',
      {},
      '0 * * * *' // Every hour
    );

    // Reconcile inventory daily at 2 AM
    await JobScheduler.addRecurringJob(
      'inventory',
      'reconcileInventory',
      {},
      '0 2 * * *' // Daily at 2 AM
    );

    logger.info('Inventory recurring jobs scheduled');
  },
};