import { Order, Cart } from '../models/index.js';
import { successResponse, NotFoundError, ValidationError } from '../middleware/error.js';

class OrderController {
  static async createOrder(req, res) {
    const userId = req.user?._id;
    const { cartId, shippingAddress, billingAddress, paymentMethod, notes, merchantId } = req.body;

    if (!merchantId) throw new ValidationError('merchantId is required');
    if (!userId) throw new ValidationError('Authentication required to create order');

    let cart = null;
    if (cartId) {
      cart = await Cart.findById(cartId);
    } else {
      cart = await Cart.findByUser(userId, merchantId);
    }
    if (!cart || cart.items.length === 0) throw new ValidationError('Cart is empty');

    const pricing = {
      subtotal: cart.totals.subtotal,
      tax: cart.totals.tax,
      shipping: cart.totals.shipping,
      discount: cart.totals.discount,
      total: cart.totals.total,
    };

    const order = await Order.create({
      userId,
      merchantId,
      items: cart.items.map(i => ({
        sku: i.sku,
        productId: i.productId,
        title: i.title,
        image: i.image,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        totalPrice: i.totalPrice,
        attributes: i.attributes,
      })),
      pricing,
      currency: cart.currency,
      couponCode: cart.couponCode,
      status: 'payment_pending',
      payment: {
        provider: paymentMethod,
        status: 'pending',
        amount: pricing.total,
        currency: cart.currency,
      },
      shipping: {
        method: 'standard',
        cost: pricing.shipping,
        address: shippingAddress,
      },
      billing: {
        address: billingAddress,
      },
      notes: { customer: notes },
      idempotencyKey: `${userId}-${Date.now()}`,
      customer: {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        acceptLanguage: req.get('Accept-Language'),
      },
    });

    // Mark cart as converted
    cart.status = 'converted';
    await cart.save();

    return successResponse(res, order, 'Order created', 201);
  }

  static async listOrders(req, res) {
    const userId = req.user?._id;
    const orders = await Order.find({ userId }).sort({ createdAt: -1 });
    return successResponse(res, orders);
  }

  static async getOrder(req, res) {
    const userId = req.user?._id;
    const { id } = req.params;
    const order = await Order.findOne({ _id: id, userId });
    if (!order) throw new NotFoundError('Order');
    return successResponse(res, order);
  }

  static async cancelOrder(req, res) {
    const userId = req.user?._id;
    const { id } = req.params;
    const order = await Order.findOne({ _id: id, userId });
    if (!order) throw new NotFoundError('Order');
    await order.cancel('Cancelled by user', userId);
    return successResponse(res, order, 'Order cancelled');
  }
}

export default OrderController;


