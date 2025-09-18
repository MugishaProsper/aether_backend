import { setupLogging } from '../../config/logging.js';
import { Order, User } from '../../models/index.js';

const logger = setupLogging();

export const processNotificationJob = async (job) => {
  const { type, data } = job.data;
  
  try {
    logger.info(`Processing notification job: ${type}`, { jobId: job.id });
    
    switch (type) {
      case 'sendOrderNotification':
        return await sendOrderNotification(data);
      case 'sendReviewRequest':
        return await sendReviewRequest(data);
      case 'sendPromotionalNotification':
        return await sendPromotionalNotification(data);
      case 'sendSystemAlert':
        return await sendSystemAlert(data);
      default:
        throw new Error(`Unknown notification type: ${type}`);
    }
    
  } catch (error) {
    logger.error(`Notification job failed: ${type}`, {
      jobId: job.id,
      error: error.message,
      data,
    });
    
    throw error;
  }
};

async function sendOrderNotification(data) {
  const { order, notificationType } = data;
  
  try {
    // This is a placeholder for push notification service integration
    // In a real implementation, you would integrate with services like:
    // - Firebase Cloud Messaging (FCM)
    // - Apple Push Notification Service (APNs)
    // - Web Push API
    // - SMS services like Twilio

    const notification = {
      title: getNotificationTitle(notificationType),
      body: getNotificationBody(notificationType, order),
      data: {
        orderId: order._id || order.orderId,
        type: notificationType,
        timestamp: new Date().toISOString(),
      },
    };

    // Send to customer
    if (order.userId) {
      await sendPushNotification(order.userId, notification);
    }

    // Send to merchant for new orders
    if (notificationType === 'new_order') {
      const merchant = await User.findOne({ 
        merchantId: order.merchantId, 
        role: 'seller' 
      });
      
      if (merchant) {
        const merchantNotification = {
          ...notification,
          title: 'New Order Received',
          body: `Order #${order.orderNumber} for ${order.pricing?.total || 0} ${order.currency}`,
        };
        await sendPushNotification(merchant._id, merchantNotification);
      }
    }

    logger.info(`Order notification sent`, {
      orderId: order._id || order.orderId,
      type: notificationType,
    });

    return {
      success: true,
      orderId: order._id || order.orderId,
      notificationType,
      notification,
    };

  } catch (error) {
    logger.error(`Error sending order notification:`, error);
    throw error;
  }
}

async function sendReviewRequest(data) {
  const { orderId } = data;
  
  try {
    const order = await Order.findById(orderId).populate('userId');
    if (!order || !order.userId) {
      throw new Error(`Order ${orderId} not found or has no user`);
    }

    // Send email review request
    const { EmailService } = await import('./email.js');
    await EmailService.sendReviewRequest(order, order.userId);

    // Send push notification
    const notification = {
      title: 'How was your order?',
      body: `Please rate and review your recent purchase from order #${order.orderNumber}`,
      data: {
        orderId: orderId,
        type: 'review_request',
        action: 'open_review_page',
      },
    };

    await sendPushNotification(order.userId._id, notification);

    logger.info(`Review request sent`, { orderId });

    return {
      success: true,
      orderId,
      userId: order.userId._id,
    };

  } catch (error) {
    logger.error(`Error sending review request:`, error);
    throw error;
  }
}

async function sendPromotionalNotification(data) {
  const { userId, title, message, actionUrl, segmentCriteria } = data;
  
  try {
    let targetUsers = [];

    if (userId) {
      // Send to specific user
      targetUsers = [userId];
    } else if (segmentCriteria) {
      // Send to user segment
      const users = await User.find(segmentCriteria).select('_id');
      targetUsers = users.map(user => user._id);
    }

    const notification = {
      title,
      body: message,
      data: {
        type: 'promotional',
        actionUrl,
        timestamp: new Date().toISOString(),
      },
    };

    let sentCount = 0;
    const batchSize = 100;

    for (let i = 0; i < targetUsers.length; i += batchSize) {
      const batch = targetUsers.slice(i, i + batchSize);
      
      const promises = batch.map(userId => 
        sendPushNotification(userId, notification).catch(error => {
          logger.error(`Failed to send notification to user ${userId}:`, error);
          return null;
        })
      );

      const results = await Promise.all(promises);
      sentCount += results.filter(result => result !== null).length;
    }

    logger.info(`Promotional notification sent`, {
      title,
      targetUsers: targetUsers.length,
      sentCount,
    });

    return {
      success: true,
      title,
      targetUsers: targetUsers.length,
      sentCount,
    };

  } catch (error) {
    logger.error(`Error sending promotional notification:`, error);
    throw error;
  }
}

async function sendSystemAlert(data) {
  const { alertType, message, severity = 'info', targetRoles = ['admin', 'superadmin'] } = data;
  
  try {
    // Find users with target roles
    const users = await User.find({ 
      role: { $in: targetRoles },
      status: 'active'
    }).select('_id email');

    const notification = {
      title: `System Alert: ${alertType}`,
      body: message,
      data: {
        type: 'system_alert',
        alertType,
        severity,
        timestamp: new Date().toISOString(),
      },
    };

    // Send push notifications
    const pushPromises = users.map(user => 
      sendPushNotification(user._id, notification).catch(error => {
        logger.error(`Failed to send system alert to user ${user._id}:`, error);
        return null;
      })
    );

    // Send emails for critical alerts
    if (severity === 'critical' || severity === 'error') {
      const { EmailService } = await import('./email.js');
      const emailPromises = users.map(user =>
        EmailService.sendSystemAlert(user.email, alertType, message, severity).catch(error => {
          logger.error(`Failed to send system alert email to ${user.email}:`, error);
          return null;
        })
      );
      
      await Promise.all(emailPromises);
    }

    await Promise.all(pushPromises);

    logger.info(`System alert sent`, {
      alertType,
      severity,
      targetUsers: users.length,
    });

    return {
      success: true,
      alertType,
      severity,
      targetUsers: users.length,
    };

  } catch (error) {
    logger.error(`Error sending system alert:`, error);
    throw error;
  }
}

// Helper functions
function getNotificationTitle(type) {
  const titles = {
    new_order: 'Order Confirmed',
    order_shipped: 'Order Shipped',
    order_delivered: 'Order Delivered',
    order_cancelled: 'Order Cancelled',
    payment_failed: 'Payment Failed',
    refund_processed: 'Refund Processed',
  };
  
  return titles[type] || 'Order Update';
}

function getNotificationBody(type, order) {
  const orderNumber = order.orderNumber || order._id;
  
  const bodies = {
    new_order: `Your order #${orderNumber} has been confirmed and is being processed.`,
    order_shipped: `Your order #${orderNumber} has been shipped and is on its way!`,
    order_delivered: `Your order #${orderNumber} has been delivered. Enjoy your purchase!`,
    order_cancelled: `Your order #${orderNumber} has been cancelled.`,
    payment_failed: `Payment failed for order #${orderNumber}. Please update your payment method.`,
    refund_processed: `Your refund for order #${orderNumber} has been processed.`,
  };
  
  return bodies[type] || `Order #${orderNumber} has been updated.`;
}

async function sendPushNotification(userId, notification) {
  // Placeholder for actual push notification implementation
  // This would integrate with services like Firebase Cloud Messaging
  
  logger.debug(`Push notification sent to user ${userId}`, {
    title: notification.title,
    body: notification.body,
  });

  // In a real implementation, you would:
  // 1. Get user's device tokens from database
  // 2. Send notification via FCM/APNs/Web Push
  // 3. Handle failed deliveries and update token status
  
  return {
    userId,
    notification,
    sent: true,
    timestamp: new Date(),
  };
}

// Notification service utility functions
export const NotificationService = {
  async sendOrderNotification(order, notificationType) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addNotificationJob('sendOrderNotification', {
      order,
      notificationType,
    });
  },

  async sendReviewRequest(orderId, delay = 0) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addNotificationJob('sendReviewRequest', { orderId }, {
      delay,
    });
  },

  async sendPromotionalNotification(title, message, options = {}) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addNotificationJob('sendPromotionalNotification', {
      title,
      message,
      ...options,
    });
  },

  async sendSystemAlert(alertType, message, severity = 'info', targetRoles = ['admin', 'superadmin']) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addNotificationJob('sendSystemAlert', {
      alertType,
      message,
      severity,
      targetRoles,
    }, { priority: 1 }); // High priority for system alerts
  },

  // Bulk notifications
  async sendBulkNotifications(notifications) {
    const { JobScheduler } = await import('../index.js');
    const jobs = notifications.map(notification => ({
      name: notification.type,
      data: notification,
    }));
    
    return JobScheduler.addBulkJobs('notification', jobs);
  },

  // Scheduled notifications
  async scheduleNotification(type, data, scheduleTime) {
    const { JobScheduler } = await import('../index.js');
    const delay = new Date(scheduleTime).getTime() - Date.now();
    
    return JobScheduler.addNotificationJob(type, data, { delay });
  },
};