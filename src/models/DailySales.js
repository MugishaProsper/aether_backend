import mongoose from 'mongoose';

const dailySalesSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    index: true,
  },
  merchantId: {
    type: String,
    required: true,
    index: true,
  },
  metrics: {
    orders: {
      total: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      cancelled: { type: Number, default: 0 },
      refunded: { type: Number, default: 0 },
    },
    revenue: {
      gross: { type: Number, default: 0 },
      net: { type: Number, default: 0 }, // After refunds
      tax: { type: Number, default: 0 },
      shipping: { type: Number, default: 0 },
      refunds: { type: Number, default: 0 },
    },
    products: {
      sold: { type: Number, default: 0 }, // Total quantity sold
      unique: { type: Number, default: 0 }, // Unique products sold
    },
    customers: {
      new: { type: Number, default: 0 },
      returning: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    conversion: {
      visitors: { type: Number, default: 0 },
      sessions: { type: Number, default: 0 },
      conversions: { type: Number, default: 0 },
      rate: { type: Number, default: 0 }, // Conversion rate percentage
    },
  },
  topProducts: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },
    sku: String,
    title: String,
    quantity: Number,
    revenue: Number,
  }],
  hourlyBreakdown: [{
    hour: { type: Number, min: 0, max: 23 },
    orders: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    visitors: { type: Number, default: 0 },
  }],
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Compound unique index
dailySalesSchema.index({ date: 1, merchantId: 1 }, { unique: true });

// Additional indexes
dailySalesSchema.index({ date: -1, merchantId: 1 });
dailySalesSchema.index({ merchantId: 1, date: -1 });
dailySalesSchema.index({ 'metrics.revenue.gross': -1 });

// Instance methods
dailySalesSchema.methods.addOrder = function(orderData) {
  this.metrics.orders.total += 1;
  
  if (orderData.status === 'completed' || orderData.status === 'delivered') {
    this.metrics.orders.completed += 1;
    this.metrics.revenue.gross += orderData.total;
    this.metrics.revenue.net += orderData.total;
    this.metrics.revenue.tax += orderData.tax;
    this.metrics.revenue.shipping += orderData.shipping;
    this.metrics.products.sold += orderData.itemCount;
  } else if (orderData.status === 'cancelled') {
    this.metrics.orders.cancelled += 1;
  }
  
  // Update hourly breakdown
  const hour = new Date(orderData.createdAt).getHours();
  let hourlyRecord = this.hourlyBreakdown.find(h => h.hour === hour);
  
  if (!hourlyRecord) {
    hourlyRecord = { hour, orders: 0, revenue: 0, visitors: 0 };
    this.hourlyBreakdown.push(hourlyRecord);
  }
  
  hourlyRecord.orders += 1;
  if (orderData.status === 'completed' || orderData.status === 'delivered') {
    hourlyRecord.revenue += orderData.total;
  }
  
  this.lastUpdated = new Date();
  return this;
};

dailySalesSchema.methods.addRefund = function(refundAmount) {
  this.metrics.orders.refunded += 1;
  this.metrics.revenue.refunds += refundAmount;
  this.metrics.revenue.net -= refundAmount;
  this.lastUpdated = new Date();
  return this;
};

dailySalesSchema.methods.updateCustomerMetrics = function(newCustomers, returningCustomers) {
  this.metrics.customers.new = newCustomers;
  this.metrics.customers.returning = returningCustomers;
  this.metrics.customers.total = newCustomers + returningCustomers;
  this.lastUpdated = new Date();
  return this;
};

dailySalesSchema.methods.updateConversionMetrics = function(visitors, sessions, conversions) {
  this.metrics.conversion.visitors = visitors;
  this.metrics.conversion.sessions = sessions;
  this.metrics.conversion.conversions = conversions;
  this.metrics.conversion.rate = sessions > 0 ? (conversions / sessions) * 100 : 0;
  this.lastUpdated = new Date();
  return this;
};

dailySalesSchema.methods.updateTopProducts = function(products) {
  this.topProducts = products.slice(0, 10); // Keep top 10
  this.metrics.products.unique = products.length;
  this.lastUpdated = new Date();
  return this;
};

// Static methods
dailySalesSchema.statics.findOrCreate = async function(date, merchantId) {
  let record = await this.findOne({ date, merchantId });
  
  if (!record) {
    record = new this({
      date,
      merchantId,
      hourlyBreakdown: Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        orders: 0,
        revenue: 0,
        visitors: 0,
      })),
    });
    await record.save();
  }
  
  return record;
};

dailySalesSchema.statics.getDateRange = function(merchantId, startDate, endDate) {
  const query = { merchantId };
  
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = startDate;
    if (endDate) query.date.$lte = endDate;
  }
  
  return this.find(query).sort({ date: -1 });
};

dailySalesSchema.statics.getSummary = function(merchantId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.aggregate([
    {
      $match: {
        merchantId,
        date: { $gte: startDate },
      }
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: '$metrics.orders.total' },
        completedOrders: { $sum: '$metrics.orders.completed' },
        cancelledOrders: { $sum: '$metrics.orders.cancelled' },
        refundedOrders: { $sum: '$metrics.orders.refunded' },
        grossRevenue: { $sum: '$metrics.revenue.gross' },
        netRevenue: { $sum: '$metrics.revenue.net' },
        totalRefunds: { $sum: '$metrics.revenue.refunds' },
        productsSold: { $sum: '$metrics.products.sold' },
        uniqueCustomers: { $sum: '$metrics.customers.total' },
        totalVisitors: { $sum: '$metrics.conversion.visitors' },
        averageOrderValue: { $avg: '$metrics.revenue.gross' },
      }
    },
    {
      $project: {
        _id: 0,
        totalOrders: 1,
        completedOrders: 1,
        cancelledOrders: 1,
        refundedOrders: 1,
        grossRevenue: 1,
        netRevenue: 1,
        totalRefunds: 1,
        productsSold: 1,
        uniqueCustomers: 1,
        totalVisitors: 1,
        averageOrderValue: { $round: ['$averageOrderValue', 2] },
        conversionRate: {
          $cond: [
            { $gt: ['$totalVisitors', 0] },
            { $multiply: [{ $divide: ['$completedOrders', '$totalVisitors'] }, 100] },
            0
          ]
        },
        completionRate: {
          $cond: [
            { $gt: ['$totalOrders', 0] },
            { $multiply: [{ $divide: ['$completedOrders', '$totalOrders'] }, 100] },
            0
          ]
        }
      }
    }
  ]);
};

dailySalesSchema.statics.getTopProducts = function(merchantId, days = 30, limit = 10) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.aggregate([
    {
      $match: {
        merchantId,
        date: { $gte: startDate },
      }
    },
    { $unwind: '$topProducts' },
    {
      $group: {
        _id: '$topProducts.sku',
        title: { $first: '$topProducts.title' },
        totalQuantity: { $sum: '$topProducts.quantity' },
        totalRevenue: { $sum: '$topProducts.revenue' },
        productId: { $first: '$topProducts.productId' },
      }
    },
    { $sort: { totalQuantity: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        sku: '$_id',
        productId: 1,
        title: 1,
        totalQuantity: 1,
        totalRevenue: 1,
        averagePrice: { $divide: ['$totalRevenue', '$totalQuantity'] },
      }
    }
  ]);
};

const DailySales = mongoose.model('DailySales', dailySalesSchema);

export default DailySales;