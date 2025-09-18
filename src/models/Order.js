import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  sku: {
    type: String,
    required: true,
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
  image: String,
  quantity: {
    type: Number,
    required: true,
    min: 1,
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
  attributes: {
    type: Map,
    of: String,
  },
  refunded: {
    quantity: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    reason: String,
    refundedAt: Date,
  },
}, { _id: true });

const shippingAddressSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: String,
  zipCode: String,
  country: { type: String, default: 'Rwanda' },
}, { _id: false });

const billingAddressSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: String,
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: String,
  zipCode: String,
  country: { type: String, default: 'Rwanda' },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  merchantId: {
    type: String,
    required: true,
    index: true,
  },
  items: [orderItemSchema],
  pricing: {
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    tax: {
      type: Number,
      required: true,
      min: 0,
    },
    shipping: {
      type: Number,
      required: true,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
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
  status: {
    type: String,
    enum: [
      'created',
      'payment_pending',
      'payment_failed',
      'paid',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'refunded',
      'partially_refunded'
    ],
    default: 'created',
    index: true,
  },
  payment: {
    provider: {
      type: String,
      enum: ['stripe', 'paypal', 'bank_transfer', 'cash_on_delivery'],
      required: true,
    },
    paymentIntentId: {
      type: String,
      index: true,
    },
    paymentMethodId: String,
    status: {
      type: String,
      enum: ['pending', 'processing', 'succeeded', 'failed', 'cancelled'],
      default: 'pending',
    },
    amount: Number,
    currency: String,
    paidAt: Date,
    failureReason: String,
    refunds: [{
      refundId: String,
      amount: Number,
      reason: String,
      status: String,
      processedAt: Date,
    }],
  },
  shipping: {
    method: {
      type: String,
      enum: ['standard', 'express', 'overnight', 'pickup'],
      default: 'standard',
    },
    cost: Number,
    carrier: String,
    trackingNumber: String,
    estimatedDelivery: Date,
    shippedAt: Date,
    deliveredAt: Date,
    address: shippingAddressSchema,
  },
  billing: {
    address: billingAddressSchema,
  },
  fulfillment: {
    status: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
    },
    processedAt: Date,
    shippedAt: Date,
    deliveredAt: Date,
    notes: String,
  },
  customer: {
    ip: String,
    userAgent: String,
    acceptLanguage: String,
  },
  notes: {
    customer: String,
    internal: String,
  },
  idempotencyKey: {
    type: String,
    unique: true,
    required: true,
    index: true,
  },
  timeline: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    notes: String,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  }],
  metadata: {
    source: {
      type: String,
      enum: ['web', 'mobile', 'api', 'admin'],
      default: 'web',
    },
    campaign: String,
    referrer: String,
  },
}, {
  timestamps: true,
});

// Indexes
orderSchema.index({ userId: 1, status: 1, createdAt: -1 });
orderSchema.index({ merchantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 }, { unique: true });
orderSchema.index({ idempotencyKey: 1 }, { unique: true });
orderSchema.index({ 'payment.paymentIntentId': 1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ createdAt: -1 });

// Pre-save middleware
orderSchema.pre('save', function(next) {
  // Generate order number if not exists
  if (!this.orderNumber) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    this.orderNumber = `ORD-${timestamp}-${random}`.toUpperCase();
  }
  
  // Add timeline entry on status change
  if (this.isModified('status')) {
    this.timeline.push({
      status: this.status,
      timestamp: new Date(),
      notes: `Order status changed to ${this.status}`,
    });
  }
  
  // Update fulfillment dates based on status
  const now = new Date();
  if (this.isModified('status')) {
    switch (this.status) {
      case 'processing':
        if (!this.fulfillment.processedAt) {
          this.fulfillment.processedAt = now;
          this.fulfillment.status = 'processing';
        }
        break;
      case 'shipped':
        if (!this.fulfillment.shippedAt) {
          this.fulfillment.shippedAt = now;
          this.fulfillment.status = 'shipped';
          this.shipping.shippedAt = now;
        }
        break;
      case 'delivered':
        if (!this.fulfillment.deliveredAt) {
          this.fulfillment.deliveredAt = now;
          this.fulfillment.status = 'delivered';
          this.shipping.deliveredAt = now;
        }
        break;
      case 'cancelled':
        this.fulfillment.status = 'cancelled';
        break;
    }
  }
  
  next();
});

// Instance methods
orderSchema.methods.canBeCancelled = function() {
  return ['created', 'payment_pending', 'paid'].includes(this.status);
};

orderSchema.methods.canBeRefunded = function() {
  return ['paid', 'processing', 'shipped', 'delivered'].includes(this.status);
};

orderSchema.methods.cancel = function(reason, cancelledBy) {
  if (!this.canBeCancelled()) {
    throw new Error('Order cannot be cancelled in current status');
  }
  
  this.status = 'cancelled';
  this.timeline.push({
    status: 'cancelled',
    timestamp: new Date(),
    notes: reason || 'Order cancelled',
    updatedBy: cancelledBy,
  });
  
  return this.save();
};

orderSchema.methods.markAsPaid = function(paymentData) {
  this.status = 'paid';
  this.payment.status = 'succeeded';
  this.payment.paidAt = new Date();
  
  if (paymentData) {
    Object.assign(this.payment, paymentData);
  }
  
  return this.save();
};

orderSchema.methods.addRefund = function(refundData) {
  this.payment.refunds.push({
    refundId: refundData.refundId,
    amount: refundData.amount,
    reason: refundData.reason,
    status: refundData.status,
    processedAt: new Date(),
  });
  
  const totalRefunded = this.payment.refunds.reduce((sum, refund) => {
    return sum + (refund.status === 'succeeded' ? refund.amount : 0);
  }, 0);
  
  if (totalRefunded >= this.pricing.total) {
    this.status = 'refunded';
  } else if (totalRefunded > 0) {
    this.status = 'partially_refunded';
  }
  
  return this.save();
};

orderSchema.methods.updateShipping = function(shippingData) {
  Object.assign(this.shipping, shippingData);
  
  if (shippingData.trackingNumber && this.status === 'processing') {
    this.status = 'shipped';
  }
  
  return this.save();
};

orderSchema.methods.getTotalQuantity = function() {
  return this.items.reduce((total, item) => total + item.quantity, 0);
};

orderSchema.methods.getRefundableAmount = function() {
  const totalRefunded = this.payment.refunds.reduce((sum, refund) => {
    return sum + (refund.status === 'succeeded' ? refund.amount : 0);
  }, 0);
  
  return Math.max(0, this.pricing.total - totalRefunded);
};

orderSchema.methods.addStatusUpdate = function(status, notes, updatedBy) {
  this.status = status;
  this.timeline.push({
    status,
    timestamp: new Date(),
    notes,
    updatedBy,
  });
  
  return this.save();
};

// Static methods
orderSchema.statics.findByOrderNumber = function(orderNumber) {
  return this.findOne({ orderNumber });
};

orderSchema.statics.findByPaymentIntent = function(paymentIntentId) {
  return this.findOne({ 'payment.paymentIntentId': paymentIntentId });
};

orderSchema.statics.findByIdempotencyKey = function(idempotencyKey) {
  return this.findOne({ idempotencyKey });
};

orderSchema.statics.getOrderStats = function(merchantId, startDate, endDate) {
  const matchStage = {
    status: { $in: ['paid', 'processing', 'shipped', 'delivered'] },
  };
  
  if (merchantId) {
    matchStage.merchantId = merchantId;
  }
  
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = startDate;
    if (endDate) matchStage.createdAt.$lte = endDate;
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$pricing.total' },
        averageOrderValue: { $avg: '$pricing.total' },
        totalItems: { $sum: { $sum: '$items.quantity' } },
      }
    }
  ]);
};

orderSchema.statics.getDailySales = function(merchantId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const matchStage = {
    status: { $in: ['paid', 'processing', 'shipped', 'delivered'] },
    createdAt: { $gte: startDate },
  };
  
  if (merchantId) {
    matchStage.merchantId = merchantId;
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' },
        },
        orders: { $sum: 1 },
        revenue: { $sum: '$pricing.total' },
        items: { $sum: { $sum: '$items.quantity' } },
      }
    },
    {
      $project: {
        _id: 0,
        date: {
          $dateFromParts: {
            year: '$_id.year',
            month: '$_id.month',
            day: '$_id.day',
          }
        },
        orders: 1,
        revenue: 1,
        items: 1,
      }
    },
    { $sort: { date: 1 } },
  ]);
};

const Order = mongoose.model('Order', orderSchema);

export default Order;