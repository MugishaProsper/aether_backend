import mongoose from 'mongoose';

const variantSchema = new mongoose.Schema({
  sku: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    required: true,
    default: 'RWF',
    enum: ['RWF', 'USD', 'EUR'],
  },
  stock: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  attributes: {
    type: Map,
    of: String, // color: "red", size: "L", etc.
  },
  dimensions: {
    weight: Number, // grams
    length: Number, // cm
    width: Number,  // cm
    height: Number, // cm
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { _id: true });

const imageSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
  },
  alt: {
    type: String,
    required: true,
  },
  isPrimary: {
    type: Boolean,
    default: false,
  },
  order: {
    type: Number,
    default: 0,
  },
}, { _id: true });

const productSchema = new mongoose.Schema({
  merchantId: {
    type: String,
    required: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxLength: 200,
  },
  slug: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
    maxLength: 5000,
  },
  shortDescription: {
    type: String,
    maxLength: 500,
  },
  categories: [{
    type: String,
    required: true,
    index: true,
  }],
  tags: [{
    type: String,
    lowercase: true,
  }],
  variants: [variantSchema],
  images: [imageSchema],
  specifications: {
    type: Map,
    of: String, // brand: "Apple", model: "iPhone 13", etc.
  },
  seo: {
    metaTitle: String,
    metaDescription: String,
    keywords: [String],
  },
  shipping: {
    weight: Number, // grams
    dimensions: {
      length: Number, // cm
      width: Number,
      height: Number,
    },
    freeShipping: { type: Boolean, default: false },
    shippingCost: { type: Number, default: 0 },
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'inactive', 'archived'],
    default: 'draft',
    index: true,
  },
  featured: {
    type: Boolean,
    default: false,
    index: true,
  },
  analytics: {
    views: { type: Number, default: 0 },
    sales: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    rating: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0 },
    },
  },
  publishedAt: Date,
  archivedAt: Date,
}, {
  timestamps: true,
});

// Compound indexes
productSchema.index({ merchantId: 1, slug: 1 }, { unique: true });
productSchema.index({ merchantId: 1, status: 1 });
productSchema.index({ categories: 1, status: 1 });
productSchema.index({ featured: 1, status: 1 });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ 'analytics.sales': -1 });
productSchema.index({ 'analytics.rating.average': -1 });

// Text index for search
productSchema.index(
  { 
    title: 'text', 
    description: 'text', 
    'specifications': 'text',
    tags: 'text' 
  },
  { 
    weights: { 
      title: 10, 
      tags: 5,
      description: 3,
      specifications: 1 
    },
    name: 'product_text_index'
  }
);

// Virtual for primary image
productSchema.virtual('primaryImage').get(function() {
  const primary = this.images.find(img => img.isPrimary);
  return primary || this.images[0];
});

// Virtual for price range
productSchema.virtual('priceRange').get(function() {
  if (this.variants.length === 0) return null;
  
  const prices = this.variants
    .filter(v => v.isActive)
    .map(v => v.price);
  
  if (prices.length === 0) return null;
  
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  
  return {
    min,
    max,
    currency: this.variants[0].currency,
  };
});

// Virtual for total stock
productSchema.virtual('totalStock').get(function() {
  return this.variants
    .filter(v => v.isActive)
    .reduce((total, variant) => total + variant.stock, 0);
});

// Pre-save middleware
productSchema.pre('save', function(next) {
  // Generate slug if not provided
  if (!this.slug) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  
  // Set published date when status changes to active
  if (this.isModified('status') && this.status === 'active' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  
  // Set archived date when status changes to archived
  if (this.isModified('status') && this.status === 'archived' && !this.archivedAt) {
    this.archivedAt = new Date();
  }
  
  // Ensure only one primary image
  const primaryImages = this.images.filter(img => img.isPrimary);
  if (primaryImages.length > 1) {
    this.images.forEach((img, index) => {
      img.isPrimary = index === 0;
    });
  } else if (primaryImages.length === 0 && this.images.length > 0) {
    this.images[0].isPrimary = true;
  }
  
  next();
});

// Instance methods
productSchema.methods.incrementViews = function() {
  return this.updateOne({ $inc: { 'analytics.views': 1 } });
};

productSchema.methods.updateRating = function(newRating) {
  const currentRating = this.analytics.rating;
  const newCount = currentRating.count + 1;
  const newAverage = ((currentRating.average * currentRating.count) + newRating) / newCount;
  
  return this.updateOne({
    'analytics.rating.average': Math.round(newAverage * 10) / 10,
    'analytics.rating.count': newCount,
  });
};

productSchema.methods.recordSale = function(quantity, amount) {
  return this.updateOne({
    $inc: {
      'analytics.sales': quantity,
      'analytics.revenue': amount,
    }
  });
};

productSchema.methods.getVariantBySku = function(sku) {
  return this.variants.find(variant => variant.sku === sku);
};

productSchema.methods.updateStock = function(sku, quantity, operation = 'set') {
  const variant = this.getVariantBySku(sku);
  if (!variant) {
    throw new Error(`Variant with SKU ${sku} not found`);
  }
  
  const update = {};
  if (operation === 'increment') {
    update.$inc = { [`variants.$.stock`]: quantity };
  } else if (operation === 'decrement') {
    update.$inc = { [`variants.$.stock`]: -quantity };
  } else {
    update.$set = { [`variants.$.stock`]: quantity };
  }
  
  return this.updateOne(
    { 'variants.sku': sku },
    update
  );
};

// Static methods
productSchema.statics.findBySlug = function(merchantId, slug) {
  return this.findOne({ merchantId, slug, status: 'active' });
};

productSchema.statics.findBySku = function(sku) {
  return this.findOne({ 
    'variants.sku': sku,
    status: 'active'
  });
};

productSchema.statics.searchProducts = function(query, filters = {}) {
  const searchQuery = {
    status: 'active',
    ...filters,
  };
  
  if (query) {
    searchQuery.$text = { $search: query };
  }
  
  return this.find(searchQuery, query ? { score: { $meta: 'textScore' } } : {})
    .sort(query ? { score: { $meta: 'textScore' } } : { createdAt: -1 });
};

productSchema.statics.findFeatured = function(limit = 10) {
  return this.find({ 
    status: 'active', 
    featured: true 
  })
    .sort({ 'analytics.sales': -1, createdAt: -1 })
    .limit(limit);
};

productSchema.statics.findTopSelling = function(merchantId, limit = 10) {
  const query = { status: 'active' };
  if (merchantId) query.merchantId = merchantId;
  
  return this.find(query)
    .sort({ 'analytics.sales': -1 })
    .limit(limit);
};

const Product = mongoose.model('Product', productSchema);

export default Product;