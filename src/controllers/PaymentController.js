import Stripe from 'stripe';
import { config } from '../config/index.js';
import { Order } from '../models/index.js';
import { successResponse, NotFoundError, ValidationError } from '../middleware/error.js';

const stripe = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: config.stripe.apiVersion })
  : null;

class PaymentController {
  static async createIntent(req, res) {
    if (!stripe) {
      return res.status(503).json({ error: 'Payment service not configured' });
    }

    const userId = req.user?._id;
    const { orderId, paymentMethodId } = req.body;

    const order = await Order.findOne({ _id: orderId, userId });
    if (!order) throw new NotFoundError('Order');

    if (order.payment.paymentIntentId) {
      // Retrieve existing
      const intent = await stripe.paymentIntents.retrieve(order.payment.paymentIntentId);
      return successResponse(res, { clientSecret: intent.client_secret, paymentIntentId: intent.id });
    }

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(order.pricing.total),
      currency: (order.currency || 'RWF').toLowerCase(),
      metadata: { orderId: order._id.toString(), userId: userId?.toString() },
      payment_method: paymentMethodId || undefined,
      confirmation_method: 'AUTOMATIC',
      capture_method: 'AUTOMATIC',
      description: `Order ${order.orderNumber}`,
    });

    order.payment.paymentIntentId = intent.id;
    order.payment.status = 'PROCESSING';
    await order.save();

    return successResponse(res, { clientSecret: intent.client_secret, paymentIntentId: intent.id }, 'Payment intent created', 201);
  }

  static async confirmPayment(req, res) {
    if (!stripe) {
      return res.status(503).json({ error: 'Payment service not configured' });
    }

    const userId = req.user?._id;
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) throw new ValidationError('paymentIntentId is required');

    const order = await Order.findByPaymentIntent(paymentIntentId);
    if (!order || order.userId.toString() !== userId.toString()) throw new NotFoundError('Order');

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status === 'SUCCEEDED') {
      await order.markAsPaid({ amount: intent.amount, currency: intent.currency });
    }

    return successResponse(res, { status: intent.status });
  }
}

export default PaymentController;


