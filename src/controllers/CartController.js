import { Cart, Product } from '../models/index.js';
import { successResponse, NotFoundError } from '../middleware/error.js';

class CartController {
  static async getCart(req, res) {
    const userId = req.user?._id;
    const sessionId = req.sessionId;
    const merchantId = req.query.merchantId;

    if (!merchantId) {
      return res.status(400).json({ error: 'merchantId is required' });
    }

    let cart;
    if (userId) {
      cart = await Cart.findOrCreateForUser(userId, merchantId);
    } else if (sessionId) {
      cart = await Cart.findOrCreateForSession(sessionId, merchantId);
    } else {
      cart = new Cart({ merchantId, status: 'active' });
      await cart.save();
    }

    return successResponse(res, cart);
  }

  static async addItem(req, res) {
    const userId = req.user?._id;
    const sessionId = req.sessionId;
    const { sku, quantity, merchantId } = req.body;

    if (!merchantId) {
      return res.status(400).json({ error: 'merchantId is required' });
    }

    const product = await Product.findBySku(sku);
    if (!product) {
      throw new NotFoundError('Product');
    }

    const variant = product.getVariantBySku(sku);
    if (!variant || !variant.isActive) {
      return res.status(400).json({ error: 'Variant unavailable' });
    }

    let cart;
    if (userId) {
      cart = await Cart.findOrCreateForUser(userId, merchantId);
    } else {
      cart = await Cart.findOrCreateForSession(sessionId, merchantId);
    }

    cart.addItem({
      sku,
      productId: product._id,
      title: product.title,
      image: product.primaryImage?.url,
      quantity,
      unitPrice: variant.price,
      currency: variant.currency,
      attributes: variant.attributes,
    });

    await cart.save();
    return successResponse(res, cart, 'Item added', 201);
  }

  static async updateItem(req, res) {
    const userId = req.user?._id;
    const sessionId = req.sessionId;
    const { merchantId } = req.body;
    const { sku } = req.params;
    const { quantity } = req.body;

    if (!merchantId) {
      return res.status(400).json({ error: 'merchantId is required' });
    }

    let cart = userId
      ? await Cart.findByUser(userId, merchantId)
      : await Cart.findBySession(sessionId, merchantId);

    if (!cart) throw new NotFoundError('Cart');

    cart.updateItemQuantity(sku, quantity);
    await cart.save();
    return successResponse(res, cart, 'Item updated');
  }

  static async removeItem(req, res) {
    const userId = req.user?._id;
    const sessionId = req.sessionId;
    const { merchantId } = req.query;
    const { sku } = req.params;

    if (!merchantId) {
      return res.status(400).json({ error: 'merchantId is required' });
    }

    let cart = userId
      ? await Cart.findByUser(userId, merchantId)
      : await Cart.findBySession(sessionId, merchantId);

    if (!cart) throw new NotFoundError('Cart');

    cart.removeItem(sku);
    await cart.save();
    return successResponse(res, cart, 'Item removed');
  }
}

export default CartController;


