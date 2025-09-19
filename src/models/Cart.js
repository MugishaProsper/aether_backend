import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema({
  sku: {
    type: String,
    required: true,
    index: true,
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  image: {
    type: String, // Primary image URL
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1,
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    required: true,
    default: 'RWF',
  },
  attributes: {
    type: Map,
    of: String, // color, size, etc.
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
  priceAtAdd: {
    type: Number,
    required: true, // Track price when item was added for price change detection
  },
}, { _id: true });

const cartSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    sparse: true, // Guest carts won't have userId
  },
  sessionId: {
    type: String,
    index: true,
    sparse: true, // For guest carts
  },
  merchantId: {
    type: String,
    required: true,
    index: true, // Carts are merchant-specific
  },
  items: [cartItemSchema],
  totals: {
    subtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    tax: {
      type: Number,
      default: 0,
      min: 0,
    },
    shipping: {
      type: Number,
      default: 0,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  currency: {
    type: String,
    required: true,
    default: 'RWF',
  },
  couponCode: {
    type: String,
    uppercase: true,
  },
  shippingAddress: {
    name: String,
    phone: String,
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: { type: String, default: 'Rwanda' },
  },
  notes: {
    type: String,
    maxLength: 500,
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'ABANDONED', 'CONVERTED', 'EXPIRED'],
    default: 'ACTIVE',
    index: true,
  },
  metadata: {
    source: {
      type: String,
      enum: ['WEB', 'MOBILE', 'API'],
      default: 'WEB',
    },
    userAgent: String,
    ipAddress: String,
  },
  expiresAt: {
    type: Date,
    index: { expireAfterSeconds: 0 }, // TTL index
  },
}, {
  timestamps: true,
});

// Indexes
cartSchema.index({ userId: 1, merchantId: 1 });
cartSchema.index({ sessionId: 1, merchantId: 1 });
cartSchema.index({ status: 1, updatedAt: -1 });
cartSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 86400 * 30 }); // Expire after 30 days

// Pre-save middleware to calculate totals
cartSchema.pre('save', function(next) {
  this.calculateTotals();
  
  // Set expiration for guest carts (24 hours)
  if (!this.userId && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  
  next();
});

// Instance methods
cartSchema.methods.calculateTotals = function() {
  const subtotal = this.items.reduce((total, item) => {
    item.totalPrice = item.unitPrice * item.quantity;
    return total + item.totalPrice;
  }, 0);
  
  this.totals.subtotal = subtotal;
  
  // Tax calculation (placeholder - implement based on business rules)
  this.totals.tax = Math.round(subtotal * 0.18); // 18% VAT for Rwanda
  
  // Shipping calculation (placeholder - implement based on business rules)
  if (subtotal < 50000) { // Free shipping above 50,000 RWF
    this.totals.shipping = 2000; // 2,000 RWF shipping
  } else {
    this.totals.shipping = 0;
  }
  
  this.totals.total = this.totals.subtotal + this.totals.tax + this.totals.shipping - this.totals.discount;
  
  return this.totals;
};

cartSchema.methods.addItem = function(item) {
  const existingItemIndex = this.items.findIndex(
    cartItem => cartItem.sku === item.sku
  );
  
  if (existingItemIndex >= 0) {
    // Update existing item
    this.items[existingItemIndex].quantity += item.quantity;
    this.items[existingItemIndex].totalPrice = 
      this.items[existingItemIndex].unitPrice * this.items[existingItemIndex].quantity;
  } else {
    // Add new item
    this.items.push({
      ...item,
      addedAt: new Date(),
      totalPrice: item.unitPrice * item.quantity,
      priceAtAdd: item.unitPrice,
    });
  }
  
  this.calculateTotals();
  return this;
};

cartSchema.methods.updateItemQuantity = function(sku, quantity) {
  const item = this.items.find(cartItem => cartItem.sku === sku);
  
  if (!item) {
    throw new Error(`Item with SKU ${sku} not found in cart`);
  }
  
  if (quantity <= 0) {
    return this.removeItem(sku);
  }
  
  item.quantity = quantity;
  item.totalPrice = item.unitPrice * quantity;
  
  this.calculateTotals();
  return this;
};

cartSchema.methods.removeItem = function(sku) {
  const itemIndex = this.items.findIndex(cartItem => cartItem.sku === sku);
  
  if (itemIndex >= 0) {
    this.items.splice(itemIndex, 1);
    this.calculateTotals();
  }
  
  return this;
};

cartSchema.methods.clearCart = function() {
  this.items = [];
  this.calculateTotals();
  return this;
};

cartSchema.methods.applyCoupon = function(couponCode, discountAmount) {
  this.couponCode = couponCode;
  this.totals.discount = discountAmount;
  this.calculateTotals();
  return this;
};

cartSchema.methods.removeCoupon = function() {
  this.couponCode = undefined;
  this.totals.discount = 0;
  this.calculateTotals();
  return this;
};

cartSchema.methods.updateShippingAddress = function(address) {
  this.shippingAddress = address;
  // Recalculate shipping based on new address
  this.calculateTotals();
  return this;
};

cartSchema.methods.getItemCount = function() {
  return this.items.reduce((total, item) => total + item.quantity, 0);
};

cartSchema.methods.hasItem = function(sku) {
  return this.items.some(item => item.sku === sku);
};

cartSchema.methods.getItem = function(sku) {
  return this.items.find(item => item.sku === sku);
};

cartSchema.methods.validateStock = async function() {
  const Product = mongoose.model('Product');
  const validationResults = [];
  
  for (const item of this.items) {
    const product = await Product.findById(item.productId);
    if (!product) {
      validationResults.push({
        sku: item.sku,
        error: 'Product not found',
        available: false,
      });
      continue;
    }
    
    const variant = product.getVariantBySku(item.sku);
    if (!variant) {
      validationResults.push({
        sku: item.sku,
        error: 'Variant not found',
        available: false,
      });
      continue;
    }
    
    if (!variant.isActive) {
      validationResults.push({
        sku: item.sku,
        error: 'Product variant is not active',
        available: false,
      });
      continue;
    }
    
    if (variant.stock < item.quantity) {
      validationResults.push({
        sku: item.sku,
        error: 'Insufficient stock',
        available: false,
        availableQuantity: variant.stock,
        requestedQuantity: item.quantity,
      });
      continue;
    }
    
    // Check for price changes
    if (variant.price !== item.priceAtAdd) {
      validationResults.push({
        sku: item.sku,
        warning: 'Price has changed',
        available: true,
        oldPrice: item.priceAtAdd,
        newPrice: variant.price,
      });
    }
    
    if (validationResults.filter(r => r.sku === item.sku).length === 0) {
      validationResults.push({
        sku: item.sku,
        available: true,
      });
    }
  }
  
  return validationResults;
};

cartSchema.methods.mergeCarts = function(guestCart) {
  if (!guestCart || !guestCart.items) return this;
  
  for (const guestItem of guestCart.items) {
    this.addItem(guestItem);
  }
  
  // Merge shipping address if not set
  if (!this.shippingAddress && guestCart.shippingAddress) {
    this.shippingAddress = guestCart.shippingAddress;
  }
  
  // Merge coupon if not set
  if (!this.couponCode && guestCart.couponCode) {
    this.couponCode = guestCart.couponCode;
    this.totals.discount = guestCart.totals.discount;
  }
  
  this.calculateTotals();
  return this;
};

// Static methods
cartSchema.statics.findByUser = function(userId, merchantId) {
  return this.findOne({ userId, merchantId, status: 'ACTIVE' });
};

cartSchema.statics.findBySession = function(sessionId, merchantId) {
  return this.findOne({ sessionId, merchantId, status: 'ACTIVE' });
};

cartSchema.statics.findOrCreateForUser = async function(userId, merchantId) {
  let cart = await this.findByUser(userId, merchantId);
  
  if (!cart) {
    cart = new this({
      userId,
      merchantId,
      status: 'ACTIVE',
    });
    await cart.save();
  }
  
  return cart;
};

cartSchema.statics.findOrCreateForSession = async function(sessionId, merchantId) {
  let cart = await this.findBySession(sessionId, merchantId);
  
  if (!cart) {
    cart = new this({
      sessionId,
      merchantId,
      status: 'ACTIVE',
    });
    await cart.save();
  }
  
  return cart;
};

cartSchema.statics.getAbandonedCarts = function(hoursAgo = 24) {
  const cutoffDate = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  
  return this.find({
    status: 'ACTIVE',
    updatedAt: { $lt: cutoffDate },
    items: { $ne: [] },
  });
};

const Cart = mongoose.model('Cart', cartSchema);

export default Cart;