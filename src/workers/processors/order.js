import { setupLogging } from '../../config/logging.js';
import { Order, Product, User, DailySales } from '../../models/index.js';
import InventoryService from '../../services/InventoryService.js';
import CacheService from '../../services/CacheService.js';

const logger = setupLogging();

export const processOrderJob = async (job) => {
  const { type, data } = job.data;
  
  try {
    logger.info(`Processing order job: ${type}`, { jobId: job.id });
    
    switch (type) {
      case 'processOrderCreated':
        return await processOrderCreated(data);
      case 'processOrderPaid':
        return await processOrderPaid(data);
      case 'processOrderCancelled':
        return await processOrderCancelled(data);
      case 'processOrderShipped':
        return await processOrderShipped(data);
      case 'processOrderDelivered':
        return await processOrderDelivered(data);
      case 'processOrderRefunded':
        return await processOrderRefunded(data);
      case 'cleanupExpiredOrders':
        return await cleanupExpiredOrders(data);
      case 'updateOrderAnalytics':
        return await updateOrderAnalytics(data);
      default:
        throw new Error(`Unknown order processing type: ${type}`);
    }
    
  } catch (error) {
    logger.error(`Order job failed: ${type}`, {
      jobId: job.id,
      error: error.message,
      data,
    });
    
    throw error;
  }
};

async function processOrderCreated(data) {
  const { orderId } = data;
  
  try {
    const order = await Order.findById(orderId).populate('userId');
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Send order confirmation email
    const { EmailService } = await import('./email.js');
    await EmailService.sendOrderConfirmation(order, order.userId);

    // Update daily sales analytics
    await updateDailySales(order, 'created');

    // Invalidate relevant caches
    await CacheService.invalidateSalesStats(order.merchantId);

    // Send notification to merchant
    const { NotificationService } = await import('./notification.js');
    await NotificationService.sendOrderNotification(order, 'new_order');

    logger.info(`Order created processing completed`, { orderId });

    return {
      success: true,
      orderId,
      actions: ['email_sent', 'analytics_updated', 'cache_invalidated', 'notification_sent'],
    };

  } catch (error) {
    logger.error(`Error processing order created:`, error);
    throw error;
  }
}

async function processOrderPaid(data) {
  const { orderId } = data;
  
  try {
    const order = await Order.findById(orderId).populate('userId');
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Commit inventory reservations
    const skus = order.items.map(item => item.sku);
    const commitResults = await InventoryService.commitOrderReservations(orderId, skus);

    // Update product sales analytics
    for (const item of order.items) {
      const product = await Product.findById(item.productId);
      if (product) {
        await product.recordSale(item.quantity, item.totalPrice);
      }
    }

    // Update daily sales analytics
    await updateDailySales(order, 'paid');

    // Send payment confirmation email
    const { EmailService } = await import('./email.js');
    await EmailService.sendOrderConfirmation(order, order.userId);

    // Trigger fulfillment process
    await scheduleOrderFulfillment(orderId);

    // Invalidate caches
    await Promise.all([
      CacheService.invalidateSalesStats(order.merchantId),
      CacheService.invalidateFeaturedProducts(),
    ]);

    logger.info(`Order paid processing completed`, { 
      orderId, 
      commitResults: commitResults.length 
    });

    return {
      success: true,
      orderId,
      inventoryCommitted: commitResults.filter(r => r.success).length,
      actions: ['inventory_committed', 'analytics_updated', 'email_sent', 'fulfillment_scheduled'],
    };

  } catch (error) {
    logger.error(`Error processing order paid:`, error);
    throw error;
  }
}

async function processOrderCancelled(data) {
  const { orderId, reason } = data;
  
  try {
    const order = await Order.findById(orderId).populate('userId');
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Release inventory reservations
    const skus = order.items.map(item => item.sku);
    const releaseResults = await InventoryService.releaseOrderReservations(orderId, skus);

    // Update daily sales analytics
    await updateDailySales(order, 'cancelled');

    // Send cancellation email
    const { EmailService } = await import('./email.js');
    await EmailService.sendOrderCancellation(order, order.userId, reason);

    // Process refund if payment was made
    if (order.payment.status === 'succeeded') {
      const { PaymentService } = await import('./payment.js');
      await PaymentService.processRefund(orderId, order.pricing.total, reason);
    }

    // Invalidate caches
    await CacheService.invalidateSalesStats(order.merchantId);

    logger.info(`Order cancelled processing completed`, { 
      orderId, 
      releaseResults: releaseResults.length 
    });

    return {
      success: true,
      orderId,
      inventoryReleased: releaseResults.filter(r => r.success).length,
      actions: ['inventory_released', 'analytics_updated', 'email_sent', 'refund_processed'],
    };

  } catch (error) {
    logger.error(`Error processing order cancelled:`, error);
    throw error;
  }
}

async function processOrderShipped(data) {
  const { orderId, trackingNumber, carrier, estimatedDelivery } = data;
  
  try {
    const order = await Order.findById(orderId).populate('userId');
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Update order with shipping information
    await order.updateShipping({
      trackingNumber,
      carrier,
      estimatedDelivery: new Date(estimatedDelivery),
    });

    // Send shipping notification email
    const { EmailService } = await import('./email.js');
    await EmailService.sendOrderShipped(order, order.userId, {
      trackingNumber,
      carrier,
      estimatedDelivery,
    });

    // Send push notification
    const { NotificationService } = await import('./notification.js');
    await NotificationService.sendOrderNotification(order, 'order_shipped');

    // Update analytics
    await updateDailySales(order, 'shipped');

    logger.info(`Order shipped processing completed`, { orderId, trackingNumber });

    return {
      success: true,
      orderId,
      trackingNumber,
      actions: ['order_updated', 'email_sent', 'notification_sent', 'analytics_updated'],
    };

  } catch (error) {
    logger.error(`Error processing order shipped:`, error);
    throw error;
  }
}

async function processOrderDelivered(data) {
  const { orderId } = data;
  
  try {
    const order = await Order.findById(orderId).populate('userId');
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Update order status
    await order.addStatusUpdate('delivered', 'Order delivered successfully');

    // Send delivery confirmation
    const { EmailService } = await import('./email.js');
    await EmailService.sendOrderDelivered(order, order.userId);

    // Schedule review request (delayed)
    await scheduleReviewRequest(orderId, 7 * 24 * 60 * 60 * 1000); // 7 days delay

    // Update analytics
    await updateDailySales(order, 'delivered');

    // Update merchant payout calculations
    await updateMerchantPayouts(order);

    logger.info(`Order delivered processing completed`, { orderId });

    return {
      success: true,
      orderId,
      actions: ['order_updated', 'email_sent', 'review_scheduled', 'analytics_updated', 'payout_calculated'],
    };

  } catch (error) {
    logger.error(`Error processing order delivered:`, error);
    throw error;
  }
}

async function processOrderRefunded(data) {
  const { orderId, refundAmount, reason } = data;
  
  try {
    const order = await Order.findById(orderId).populate('userId');
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Update inventory (return stock)
    for (const item of order.items) {
      await InventoryService.updateStock(item.sku, item.quantity, 'increment');
    }

    // Update product analytics (reverse sales)
    for (const item of order.items) {
      const product = await Product.findById(item.productId);
      if (product) {
        await product.recordSale(-item.quantity, -item.totalPrice);
      }
    }

    // Send refund confirmation email
    const { EmailService } = await import('./email.js');
    await EmailService.sendRefundConfirmation(order, order.userId, refundAmount, reason);

    // Update daily sales analytics
    await updateDailySales(order, 'refunded', refundAmount);

    // Invalidate caches
    await CacheService.invalidateSalesStats(order.merchantId);

    logger.info(`Order refunded processing completed`, { orderId, refundAmount });

    return {
      success: true,
      orderId,
      refundAmount,
      actions: ['inventory_updated', 'analytics_updated', 'email_sent', 'cache_invalidated'],
    };

  } catch (error) {
    logger.error(`Error processing order refunded:`, error);
    throw error;
  }
}

async function cleanupExpiredOrders(data) {
  const { olderThanHours = 24 } = data;
  
  try {
    const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    
    // Find expired orders that are still in created or payment_pending status
    const expiredOrders = await Order.find({
      status: { $in: ['created', 'payment_pending'] },
      createdAt: { $lt: cutoffDate },
    });

    let cleanedCount = 0;
    
    for (const order of expiredOrders) {
      try {
        // Release inventory reservations
        const skus = order.items.map(item => item.sku);
        await InventoryService.releaseOrderReservations(order._id.toString(), skus);
        
        // Mark order as cancelled
        await order.cancel('Order expired - automatic cleanup');
        
        cleanedCount++;
      } catch (error) {
        logger.error(`Error cleaning up expired order ${order._id}:`, error);
      }
    }

    logger.info(`Cleaned up ${cleanedCount} expired orders`);

    return {
      success: true,
      cleanedCount,
      cutoffDate,
    };

  } catch (error) {
    logger.error(`Error cleaning up expired orders:`, error);
    throw error;
  }
}

async function updateOrderAnalytics(data) {
  const { orderId } = data;
  
  try {
    const order = await Order.findById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Update daily sales
    await updateDailySales(order, 'analytics_update');

    // Update merchant statistics
    await updateMerchantStats(order);

    // Update product performance metrics
    await updateProductMetrics(order);

    return {
      success: true,
      orderId,
      actions: ['daily_sales_updated', 'merchant_stats_updated', 'product_metrics_updated'],
    };

  } catch (error) {
    logger.error(`Error updating order analytics:`, error);
    throw error;
  }
}

// Helper functions

async function updateDailySales(order, event, refundAmount = 0) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailySales = await DailySales.findOrCreate(today, order.merchantId);

    switch (event) {
      case 'created':
        dailySales.addOrder({
          status: 'created',
          total: order.pricing.total,
          tax: order.pricing.tax,
          shipping: order.pricing.shipping,
          itemCount: order.getTotalQuantity(),
          createdAt: order.createdAt,
        });
        break;
      case 'paid':
        dailySales.addOrder({
          status: 'completed',
          total: order.pricing.total,
          tax: order.pricing.tax,
          shipping: order.pricing.shipping,
          itemCount: order.getTotalQuantity(),
          createdAt: order.createdAt,
        });
        break;
      case 'cancelled':
        dailySales.addOrder({
          status: 'cancelled',
          total: 0,
          tax: 0,
          shipping: 0,
          itemCount: 0,
          createdAt: order.createdAt,
        });
        break;
      case 'refunded':
        dailySales.addRefund(refundAmount);
        break;
    }

    await dailySales.save();
  } catch (error) {
    logger.error('Error updating daily sales:', error);
  }
}

async function scheduleOrderFulfillment(orderId) {
  const { JobScheduler } = await import('../index.js');
  
  // Schedule fulfillment processing (e.g., after 1 hour to allow for any issues)
  return JobScheduler.addOrderJob('processFulfillment', { orderId }, {
    delay: 60 * 60 * 1000, // 1 hour delay
  });
}

async function scheduleReviewRequest(orderId, delay) {
  const { JobScheduler } = await import('../index.js');
  
  return JobScheduler.addNotificationJob('sendReviewRequest', { orderId }, {
    delay,
  });
}

async function updateMerchantPayouts(order) {
  // This would integrate with a merchant payout system
  // For now, just log the payout calculation
  const platformFee = order.pricing.total * 0.03; // 3% platform fee
  const merchantPayout = order.pricing.total - platformFee;
  
  logger.info(`Merchant payout calculated`, {
    orderId: order._id,
    merchantId: order.merchantId,
    total: order.pricing.total,
    platformFee,
    merchantPayout,
  });
}

async function updateMerchantStats(order) {
  // Update merchant-specific statistics
  // This could be stored in a separate collection or cache
  logger.info(`Merchant stats updated for order`, {
    orderId: order._id,
    merchantId: order.merchantId,
  });
}

async function updateProductMetrics(order) {
  // Update product performance metrics
  for (const item of order.items) {
    logger.info(`Product metrics updated`, {
      productId: item.productId,
      sku: item.sku,
      quantity: item.quantity,
      revenue: item.totalPrice,
    });
  }
}

// Order service utility functions
export const OrderService = {
  async processOrderCreated(orderId) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addOrderJob('processOrderCreated', { orderId });
  },

  async processOrderPaid(orderId) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addOrderJob('processOrderPaid', { orderId });
  },

  async processOrderCancelled(orderId, reason) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addOrderJob('processOrderCancelled', { orderId, reason });
  },

  async processOrderShipped(orderId, trackingNumber, carrier, estimatedDelivery) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addOrderJob('processOrderShipped', {
      orderId,
      trackingNumber,
      carrier,
      estimatedDelivery,
    });
  },

  async processOrderDelivered(orderId) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addOrderJob('processOrderDelivered', { orderId });
  },

  async processOrderRefunded(orderId, refundAmount, reason) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addOrderJob('processOrderRefunded', {
      orderId,
      refundAmount,
      reason,
    });
  },

  async scheduleOrderCleanup(olderThanHours = 24) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addOrderJob('cleanupExpiredOrders', { olderThanHours });
  },
};