import Stripe from 'stripe';
import { config } from '../../config/index.js';
import { setupLogging } from '../../config/logging.js';
import { Order, User } from '../../models/index.js';
import { recordPaymentMetric } from '../../config/metrics.js';

const logger = setupLogging();

// Initialize Stripe
const stripe = new Stripe(config.stripe.secretKey, {
  apiVersion: config.stripe.apiVersion,
});

export const processPaymentJob = async (job) => {
  const { type, data } = job.data;
  
  try {
    logger.info(`Processing payment job: ${type}`, { jobId: job.id });
    
    switch (type) {
      case 'processPaymentIntent':
        return await processPaymentIntent(data);
      case 'handlePaymentSuccess':
        return await handlePaymentSuccess(data);
      case 'handlePaymentFailed':
        return await handlePaymentFailed(data);
      case 'processRefund':
        return await processRefund(data);
      case 'processPartialRefund':
        return await processPartialRefund(data);
      case 'reconcilePayments':
        return await reconcilePayments(data);
      default:
        throw new Error(`Unknown payment processing type: ${type}`);
    }
    
  } catch (error) {
    logger.error(`Payment job failed: ${type}`, {
      jobId: job.id,
      error: error.message,
      data,
    });
    
    throw error;
  }
};

async function processPaymentIntent(data) {
  const { orderId, paymentMethodId, customerId } = data;
  const startTime = Date.now();
  
  try {
    const order = await Order.findById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(order.pricing.total * 100), // Convert to cents
      currency: order.currency.toLowerCase(),
      customer: customerId,
      payment_method: paymentMethodId,
      confirmation_method: 'manual',
      confirm: true,
      metadata: {
        orderId: orderId,
        merchantId: order.merchantId,
      },
    });

    // Update order with payment intent
    order.payment.paymentIntentId = paymentIntent.id;
    order.payment.status = paymentIntent.status;
    await order.save();

    const duration = (Date.now() - startTime) / 1000;
    recordPaymentMetric('duration', 'stripe', null, duration);

    if (paymentIntent.status === 'succeeded') {
      recordPaymentMetric('attempts', 'stripe', 'succeeded');
      
      // Process successful payment
      const { OrderService } = await import('./order.js');
      await OrderService.processOrderPaid(orderId);
    } else if (paymentIntent.status === 'requires_action') {
      recordPaymentMetric('attempts', 'stripe', 'requires_action');
    }

    logger.info(`Payment intent processed`, {
      orderId,
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
      amount: order.pricing.total,
    });

    return {
      success: true,
      orderId,
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
      clientSecret: paymentIntent.client_secret,
    };

  } catch (error) {
    recordPaymentMetric('attempts', 'stripe', 'failed');
    logger.error(`Error processing payment intent:`, error);
    throw error;
  }
}

async function handlePaymentSuccess(data) {
  const { paymentIntentId } = data;
  
  try {
    const order = await Order.findOne({ 'payment.paymentIntentId': paymentIntentId });
    if (!order) {
      throw new Error(`Order not found for payment intent ${paymentIntentId}`);
    }

    // Update order status
    await order.markAsPaid({
      status: 'succeeded',
      paidAt: new Date(),
    });

    recordPaymentMetric('attempts', 'stripe', 'succeeded');

    // Process order fulfillment
    const { OrderService } = await import('./order.js');
    await OrderService.processOrderPaid(order._id.toString());

    logger.info(`Payment success processed`, {
      orderId: order._id,
      paymentIntentId,
      amount: order.pricing.total,
    });

    return {
      success: true,
      orderId: order._id,
      paymentIntentId,
      amount: order.pricing.total,
    };

  } catch (error) {
    logger.error(`Error handling payment success:`, error);
    throw error;
  }
}

async function handlePaymentFailed(data) {
  const { paymentIntentId, failureReason } = data;
  
  try {
    const order = await Order.findOne({ 'payment.paymentIntentId': paymentIntentId });
    if (!order) {
      throw new Error(`Order not found for payment intent ${paymentIntentId}`);
    }

    // Update order status
    order.status = 'payment_failed';
    order.payment.status = 'failed';
    order.payment.failureReason = failureReason;
    await order.save();

    recordPaymentMetric('attempts', 'stripe', 'failed');

    // Send payment failure notification
    const user = await User.findById(order.userId);
    if (user) {
      const { EmailService } = await import('./email.js');
      await EmailService.sendPaymentFailed(order, user, failureReason, `${process.env.FRONTEND_URL}/orders/${order._id}/retry`);
    }

    // Release inventory reservations
    const { OrderService } = await import('./order.js');
    await OrderService.processOrderCancelled(order._id.toString(), `Payment failed: ${failureReason}`);

    logger.info(`Payment failure processed`, {
      orderId: order._id,
      paymentIntentId,
      failureReason,
    });

    return {
      success: true,
      orderId: order._id,
      paymentIntentId,
      failureReason,
    };

  } catch (error) {
    logger.error(`Error handling payment failure:`, error);
    throw error;
  }
}

async function processRefund(data) {
  const { orderId, amount, reason = 'requested_by_customer' } = data;
  
  try {
    const order = await Order.findById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (!order.payment.paymentIntentId) {
      throw new Error(`No payment intent found for order ${orderId}`);
    }

    // Create refund in Stripe
    const refund = await stripe.refunds.create({
      payment_intent: order.payment.paymentIntentId,
      amount: Math.round(amount * 100), // Convert to cents
      reason,
      metadata: {
        orderId: orderId,
        merchantId: order.merchantId,
      },
    });

    // Update order with refund information
    await order.addRefund({
      refundId: refund.id,
      amount: amount,
      reason: reason,
      status: refund.status,
    });

    // Process order refund
    const { OrderService } = await import('./order.js');
    await OrderService.processOrderRefunded(orderId, amount, reason);

    logger.info(`Refund processed`, {
      orderId,
      refundId: refund.id,
      amount,
      reason,
    });

    return {
      success: true,
      orderId,
      refundId: refund.id,
      amount,
      status: refund.status,
    };

  } catch (error) {
    logger.error(`Error processing refund:`, error);
    throw error;
  }
}

async function processPartialRefund(data) {
  const { orderId, items, reason = 'partial_refund' } = data;
  
  try {
    const order = await Order.findById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Calculate refund amount
    let refundAmount = 0;
    for (const refundItem of items) {
      const orderItem = order.items.find(item => item.sku === refundItem.sku);
      if (orderItem) {
        const itemRefundAmount = (orderItem.unitPrice * refundItem.quantity);
        refundAmount += itemRefundAmount;
        
        // Update item refund information
        orderItem.refunded.quantity += refundItem.quantity;
        orderItem.refunded.amount += itemRefundAmount;
        orderItem.refunded.reason = reason;
        orderItem.refunded.refundedAt = new Date();
      }
    }

    if (refundAmount === 0) {
      throw new Error('No valid items found for refund');
    }

    // Process the refund
    return await processRefund({ orderId, amount: refundAmount, reason });

  } catch (error) {
    logger.error(`Error processing partial refund:`, error);
    throw error;
  }
}

async function reconcilePayments(data) {
  const { startDate, endDate } = data;
  
  try {
    // Get payments from Stripe
    const stripePayments = await stripe.paymentIntents.list({
      created: {
        gte: Math.floor(new Date(startDate).getTime() / 1000),
        lte: Math.floor(new Date(endDate).getTime() / 1000),
      },
      limit: 100,
    });

    const reconciliationResults = {
      total: stripePayments.data.length,
      matched: 0,
      unmatched: [],
      discrepancies: [],
    };

    for (const payment of stripePayments.data) {
      const orderId = payment.metadata?.orderId;
      
      if (!orderId) {
        reconciliationResults.unmatched.push({
          paymentIntentId: payment.id,
          amount: payment.amount / 100,
          reason: 'No order ID in metadata',
        });
        continue;
      }

      const order = await Order.findById(orderId);
      
      if (!order) {
        reconciliationResults.unmatched.push({
          paymentIntentId: payment.id,
          orderId,
          amount: payment.amount / 100,
          reason: 'Order not found in database',
        });
        continue;
      }

      // Check for discrepancies
      const stripeAmount = payment.amount / 100;
      const orderAmount = order.pricing.total;
      
      if (Math.abs(stripeAmount - orderAmount) > 0.01) {
        reconciliationResults.discrepancies.push({
          paymentIntentId: payment.id,
          orderId,
          stripeAmount,
          orderAmount,
          difference: stripeAmount - orderAmount,
        });
      } else {
        reconciliationResults.matched++;
      }
    }

    logger.info(`Payment reconciliation completed`, reconciliationResults);

    return {
      success: true,
      period: { startDate, endDate },
      results: reconciliationResults,
    };

  } catch (error) {
    logger.error(`Error reconciling payments:`, error);
    throw error;
  }
}

// Payment service utility functions
export const PaymentService = {
  async processPaymentIntent(orderId, paymentMethodId, customerId) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addPaymentJob('processPaymentIntent', {
      orderId,
      paymentMethodId,
      customerId,
    });
  },

  async handlePaymentSuccess(paymentIntentId) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addPaymentJob('handlePaymentSuccess', {
      paymentIntentId,
    });
  },

  async handlePaymentFailed(paymentIntentId, failureReason) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addPaymentJob('handlePaymentFailed', {
      paymentIntentId,
      failureReason,
    });
  },

  async processRefund(orderId, amount, reason) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addPaymentJob('processRefund', {
      orderId,
      amount,
      reason,
    });
  },

  async processPartialRefund(orderId, items, reason) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addPaymentJob('processPartialRefund', {
      orderId,
      items,
      reason,
    });
  },

  async schedulePaymentReconciliation(startDate, endDate) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addPaymentJob('reconcilePayments', {
      startDate,
      endDate,
    });
  },
};