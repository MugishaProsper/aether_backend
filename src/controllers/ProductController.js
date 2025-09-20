import { Product } from '../models/index.js';
import { successResponse, NotFoundError, ValidationError } from '../middleware/error.js';

class ProductController {
  // Public listing
  static async getProducts(req, res) {
    const { page = 1, limit = 20, sort = '-createdAt', q, categories, minPrice, maxPrice, inStock, featured, merchantId } = req.query;
    const filters = {};
    if (merchantId) filters.merchantId = merchantId;
    if (categories) filters.categories = { $in: Array.isArray(categories) ? categories : [categories] };
    if (featured !== undefined) filters.featured = featured === 'true';
    if (inStock !== undefined) filters['variants.stock'] = featured === 'true' ? { $gt: 0 } : { $gte: 0 };
    if (minPrice !== undefined || maxPrice !== undefined) {
      filters['variants.price'] = {};
      if (minPrice !== undefined) filters['variants.price'].$gte = Number(minPrice);
      if (maxPrice !== undefined) filters['variants.price'].$lte = Number(maxPrice);
    }

    const query = q ? Product.searchProducts(q, filters) : Product.find({ status: 'ACTIVE', ...filters });
    const total = await Product.countDocuments({ status: 'ACTIVE', ...filters });
    const data = await query
      .sort(sort)
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    return successResponse(res, data, 'Products', 200);
  }

  static async getFeaturedProducts(req, res) {
    const { limit = 10 } = req.query;
    const products = await Product.findFeatured(Number(limit));
    return successResponse(res, products);
  }

  static async getCategories(req, res) {
    const categories = await Product.distinct('categories', { status: 'ACTIVE' });
    return successResponse(res, categories);
  }

  static async searchProducts(req, res) {
    const { q, page = 1, limit = 20, sort = '-createdAt', merchantId } = req.query;
    const filters = merchantId ? { merchantId } : {};
    const query = Product.searchProducts(q, filters);
    const total = await Product.countDocuments({ status: 'ACTIVE', ...filters });
    const data = await query.sort(sort).skip((Number(page) - 1) * Number(limit)).limit(Number(limit));
    return successResponse(res, data, 'Products', 200);
  }

  static async getProduct(req, res) {
    const { productId } = req.params;
    const product = await Product.findById(productId);
    if (!product) throw new NotFoundError('Product');
    return successResponse(res, product);
  }

  static async getProductVariant(req, res) {
    const { productId, sku } = req.params;
    const product = await Product.findById(productId);
    if (!product) throw new NotFoundError('Product');
    const variant = product.getVariantBySku(sku);
    if (!variant) throw new NotFoundError('Variant');
    return successResponse(res, { productId: product._id, variant });
  }

  static async getRelatedProducts(req, res) {
    const { productId } = req.params;
    const { limit = 10 } = req.query;
    const product = await Product.findById(productId);
    if (!product) throw new NotFoundError('Product');
    const related = await Product.find({
      _id: { $ne: product._id },
      categories: { $in: product.categories },
      status: 'ACTIVE',
    }).limit(Number(limit));
    return successResponse(res, related);
  }

  // Merchant/Admin
  static async createProduct(req, res) {
    const data = req.body;
    data.merchantId = data.merchantId || req.user?.merchantId;
    if (!data.merchantId) throw new ValidationError('merchantId is required');
    const product = await Product.create(data);
    return successResponse(res, product, 'Product created', 201);
  }

  static async updateProduct(req, res) {
    const { productId } = req.params;
    const updates = req.body;
    const product = await Product.findByIdAndUpdate(productId, updates, { new: true });
    if (!product) throw new NotFoundError('Product');
    return successResponse(res, product, 'Product updated');
  }

  static async deleteProduct(req, res) {
    const { productId } = req.params;
    const product = await Product.findByIdAndDelete(productId);
    if (!product) throw new NotFoundError('Product');
    return successResponse(res, { id: productId }, 'Product deleted');
  }

  static async uploadImages(req, res) {
    const { productId } = req.params;
    const product = await Product.findById(productId);
    if (!product) throw new NotFoundError('Product');
    const files = req.files || [];
    const newImages = files.map((f, idx) => ({ url: `/uploads/${f.filename}`, alt: product.title, isPrimary: false, order: idx }));
    product.images = [...product.images, ...newImages];
    await product.save();
    return successResponse(res, product.images, 'Images uploaded', 201);
  }

  static async deleteImage(req, res) {
    const { productId, imageId } = req.params;
    const product = await Product.findById(productId);
    if (!product) throw new NotFoundError('Product');
    product.images = product.images.filter(img => img._id.toString() !== imageId);
    await product.save();
    return successResponse(res, product.images, 'Image deleted');
  }

  static async updateStatus(req, res) {
    const { productId } = req.params;
    const { status } = req.body;
    const product = await Product.findByIdAndUpdate(productId, { status }, { new: true });
    if (!product) throw new NotFoundError('Product');
    return successResponse(res, product, 'Status updated');
  }

  static async toggleFeatured(req, res) {
    const { productId } = req.params;
    const { featured } = req.body;
    const product = await Product.findByIdAndUpdate(productId, { featured }, { new: true });
    if (!product) throw new NotFoundError('Product');
    return successResponse(res, product, 'Featured updated');
  }

  static async addVariant(req, res) {
    const { productId } = req.params;
    const variant = req.body;
    const product = await Product.findById(productId);
    if (!product) throw new NotFoundError('Product');
    product.variants.push(variant);
    await product.save();
    return successResponse(res, product, 'Variant added', 201);
  }

  static async updateVariant(req, res) {
    const { productId, sku } = req.params;
    const updates = req.body;
    const product = await Product.findById(productId);
    if (!product) throw new NotFoundError('Product');
    const variant = product.getVariantBySku(sku);
    if (!variant) throw new NotFoundError('Variant');
    Object.assign(variant, updates);
    await product.save();
    return successResponse(res, product, 'Variant updated');
  }

  static async deleteVariant(req, res) {
    const { productId, sku } = req.params;
    const product = await Product.findById(productId);
    if (!product) throw new NotFoundError('Product');
    product.variants = product.variants.filter(v => v.sku !== sku);
    await product.save();
    return successResponse(res, product, 'Variant deleted');
  }

  static async updateStock(req, res) {
    const { productId, sku } = req.params;
    const { stock, operation = 'set' } = req.body;
    const product = await Product.findById(productId);
    if (!product) throw new NotFoundError('Product');
    await product.updateStock(sku, Number(stock), operation);
    const refreshed = await Product.findById(productId);
    return successResponse(res, refreshed, 'Stock updated');
  }

  static async getProductAnalytics(req, res) {
    // Placeholder: return basic analytics from the product document
    const { productId } = req.params;
    const product = await Product.findById(productId);
    if (!product) throw new NotFoundError('Product');
    return successResponse(res, product.analytics || {});
  }

  static async recordView(req, res) {
    const { productId } = req.params;
    const product = await Product.findById(productId);
    if (!product) throw new NotFoundError('Product');
    await product.incrementViews();
    return successResponse(res, { views: (product.analytics?.views || 0) + 1 }, 'View recorded');
  }

  static async bulkUpdateStatus(req, res) {
    const { productIds, status } = req.body;
    await Product.updateMany({ _id: { $in: productIds } }, { status });
    return successResponse(res, { updated: productIds.length }, 'Status updated');
  }

  static async bulkDelete(req, res) {
    const { productIds } = req.body;
    await Product.deleteMany({ _id: { $in: productIds } });
    return successResponse(res, { deleted: productIds.length }, 'Products deleted');
  }

  static async importProducts(req, res) {
    // Placeholder import handler
    return successResponse(res, { imported: 0 }, 'Import not implemented');
  }

  static async exportProducts(req, res) {
    // Placeholder export handler
    return successResponse(res, [], 'Export not implemented');
  }
}

export default ProductController;


