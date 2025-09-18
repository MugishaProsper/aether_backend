import Stripe from 'stripe';
import { config } from '../config/index.js';
import { Order } from '../models/index.js';
import { successResponse } from '../middleware/error.js';

const stripe = config.stripe.secretKey
  ? new Stripe(config.stripe.secretKey, { apiVersion: config.stripe.apiVersion })
  : null;

class WebhookController {
  static async stripe(req, res) {
    if (!stripe || !config.stripe.webhookSecret) {
      return res.status(503).json({ error: 'Webhook service not configured' });
    }

    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, config.stripe.webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        const order = await Order.findByPaymentIntent(intent.id);
        if (order) {
          await order.markAsPaid({ amount: intent.amount, currency: intent.currency });
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        const order = await Order.findByPaymentIntent(intent.id);
        if (order) {
          order.payment.status = 'failed';
          order.payment.failureReason = intent.last_payment_error?.message;
          await order.save();
        }
        break;
      }
    }

    return res.json({ received: true });
  }
}

export default WebhookController;


