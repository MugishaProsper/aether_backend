import { setupLogging } from '../../config/logging.js';
import { Order, Product, User, DailySales } from '../../models/index.js';
import CacheService from '../../services/CacheService.js';

const logger = setupLogging();

export const processAnalyticsJob = async (job) => {
  const { type, data } = job.data;
  
  try {
    logger.info(`Processing analytics job: ${type}`, { jobId: job.id });
    
    switch (type) {
      case 'updateDailySales':
        return await updateDailySales(data);
      case 'calculateMerchantStats':
        return await calculateMerchantStats(data);
      case 'updateProductMetrics':
        return await updateProductMetrics(data);
      case 'generateSalesReport':
        return await generateSalesReport(data);
      case 'calculateConversionFunnel':
        return await calculateConversionFunnel(data);
      case 'aggregateTopProducts':
        return await aggregateTopProducts(data);
      default:
        throw new Error(`Unknown analytics processing type: ${type}`);
    }
    
  } catch (error) {
    logger.error(`Analytics job failed: ${type}`, {
      jobId: job.id,
      error: error.message,
      data,
    });
    
    throw error;
  }
};

async function updateDailySales(data) {
  const { date, merchantId } = data;
  
  try {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);

    // Get all orders for the day
    const orders = await Order.find({
      merchantId,
      createdAt: {
        $gte: targetDate,
        $lt: nextDate,
      },
    });

    // Get or create daily sales record
    const dailySales = await DailySales.findOrCreate(targetDate, merchantId);

    // Reset metrics
    dailySales.metrics = {
      orders: { total: 0, completed: 0, cancelled: 0, refunded: 0 },
      revenue: { gross: 0, net: 0, tax: 0, shipping: 0, refunds: 0 },
      products: { sold: 0, unique: 0 },
      customers: { new: 0, returning: 0, total: 0 },
      conversion: { visitors: 0, sessions: 0, conversions: 0, rate: 0 },
    };

    // Process orders
    const productSales = new Map();
    const customerIds = new Set();

    for (const order of orders) {
      dailySales.metrics.orders.total++;
      
      switch (order.status) {
        case 'delivered':
        case 'paid':
        case 'processing':
        case 'shipped':
          dailySales.metrics.orders.completed++;
          dailySales.metrics.revenue.gross += order.pricing.total;
          dailySales.metrics.revenue.net += order.pricing.total;
          dailySales.metrics.revenue.tax += order.pricing.tax;
          dailySales.metrics.revenue.shipping += order.pricing.shipping;
          
          // Track product sales
          for (const item of order.items) {
            const key = `${item.productId}_${item.sku}`;
            if (!productSales.has(key)) {
              productSales.set(key, {
                productId: item.productId,
                sku: item.sku,
                title: item.title,
                quantity: 0,
                revenue: 0,
              });
            }
            const productSale = productSales.get(key);
            productSale.quantity += item.quantity;
            productSale.revenue += item.totalPrice;
            
            dailySales.metrics.products.sold += item.quantity;
          }
          
          customerIds.add(order.userId.toString());
          break;
          
        case 'cancelled':
          dailySales.metrics.orders.cancelled++;
          break;
          
        case 'refunded':
        case 'partially_refunded':
          dailySales.metrics.orders.refunded++;
          if (order.payment.refunds) {
            const totalRefunded = order.payment.refunds.reduce((sum, refund) => 
              sum + (refund.status === 'succeeded' ? refund.amount : 0), 0
            );
            dailySales.metrics.revenue.refunds += totalRefunded;
            dailySales.metrics.revenue.net -= totalRefunded;
          }
          break;
      }
    }

    // Update top products
    dailySales.topProducts = Array.from(productSales.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
    
    dailySales.metrics.products.unique = productSales.size;
    dailySales.metrics.customers.total = customerIds.size;

    // Calculate customer metrics (new vs returning)
    if (customerIds.size > 0) {
      const customerFirstOrders = await Order.aggregate([
        { $match: { userId: { $in: Array.from(customerIds).map(id => new mongoose.Types.ObjectId(id)) } } },
        { $sort: { createdAt: 1 } },
        { $group: { _id: '$userId', firstOrder: { $first: '$createdAt' } } },
      ]);

      for (const customer of customerFirstOrders) {
        if (customer.firstOrder >= targetDate && customer.firstOrder < nextDate) {
          dailySales.metrics.customers.new++;
        } else {
          dailySales.metrics.customers.returning++;
        }
      }
    }

    await dailySales.save();

    logger.info(`Daily sales updated`, {
      date: targetDate.toISOString(),
      merchantId,
      orders: dailySales.metrics.orders.total,
      revenue: dailySales.metrics.revenue.gross,
    });

    return {
      success: true,
      date: targetDate,
      merchantId,
      metrics: dailySales.metrics,
    };

  } catch (error) {
    logger.error(`Error updating daily sales:`, error);
    throw error;
  }
}

async function calculateMerchantStats(data) {
  const { merchantId, period = 30 } = data;
  
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);

    const stats = await DailySales.getSummary(merchantId, period);
    
    // Cache the results
    await CacheService.setSalesStats(merchantId, `${period}d`, stats[0] || {});

    logger.info(`Merchant stats calculated`, {
      merchantId,
      period,
      stats: stats[0],
    });

    return {
      success: true,
      merchantId,
      period,
      stats: stats[0] || {},
    };

  } catch (error) {
    logger.error(`Error calculating merchant stats:`, error);
    throw error;
  }
}

async function updateProductMetrics(data) {
  const { productId } = data;
  
  try {
    const product = await Product.findById(productId);
    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    // Calculate metrics from orders
    const orderStats = await Order.aggregate([
      { $match: { 'items.productId': product._id, status: { $in: ['paid', 'processing', 'shipped', 'delivered'] } } },
      { $unwind: '$items' },
      { $match: { 'items.productId': product._id } },
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.totalPrice' },
          orderCount: { $sum: 1 },
        }
      },
    ]);

    if (orderStats.length > 0) {
      const stats = orderStats[0];
      product.analytics.sales = stats.totalSales;
      product.analytics.revenue = stats.totalRevenue;
      await product.save();

      logger.info(`Product metrics updated`, {
        productId,
        sales: stats.totalSales,
        revenue: stats.totalRevenue,
        orders: stats.orderCount,
      });
    }

    return {
      success: true,
      productId,
      metrics: product.analytics,
    };

  } catch (error) {
    logger.error(`Error updating product metrics:`, error);
    throw error;
  }
}

async function generateSalesReport(data) {
  const { merchantId, startDate, endDate, groupBy = 'day' } = data;
  
  try {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const dailySalesData = await DailySales.getDateRange(merchantId, start, end);
    
    let groupedData = {};
    
    for (const dailySale of dailySalesData) {
      let key;
      
      switch (groupBy) {
        case 'week':
          const week = getWeekNumber(dailySale.date);
          key = `${dailySale.date.getFullYear()}-W${week}`;
          break;
        case 'month':
          key = `${dailySale.date.getFullYear()}-${String(dailySale.date.getMonth() + 1).padStart(2, '0')}`;
          break;
        default: // day
          key = dailySale.date.toISOString().split('T')[0];
      }

      if (!groupedData[key]) {
        groupedData[key] = {
          period: key,
          orders: { total: 0, completed: 0, cancelled: 0, refunded: 0 },
          revenue: { gross: 0, net: 0, tax: 0, shipping: 0, refunds: 0 },
          products: { sold: 0, unique: 0 },
          customers: { new: 0, returning: 0, total: 0 },
        };
      }

      // Aggregate data
      const group = groupedData[key];
      const metrics = dailySale.metrics;
      
      group.orders.total += metrics.orders.total;
      group.orders.completed += metrics.orders.completed;
      group.orders.cancelled += metrics.orders.cancelled;
      group.orders.refunded += metrics.orders.refunded;
      
      group.revenue.gross += metrics.revenue.gross;
      group.revenue.net += metrics.revenue.net;
      group.revenue.tax += metrics.revenue.tax;
      group.revenue.shipping += metrics.revenue.shipping;
      group.revenue.refunds += metrics.revenue.refunds;
      
      group.products.sold += metrics.products.sold;
      group.products.unique += metrics.products.unique;
      
      group.customers.new += metrics.customers.new;
      group.customers.returning += metrics.customers.returning;
      group.customers.total += metrics.customers.total;
    }

    const report = {
      merchantId,
      period: { startDate, endDate },
      groupBy,
      data: Object.values(groupedData).sort((a, b) => a.period.localeCompare(b.period)),
      summary: calculateSummary(Object.values(groupedData)),
    };

    logger.info(`Sales report generated`, {
      merchantId,
      period: `${startDate} to ${endDate}`,
      groupBy,
      dataPoints: report.data.length,
    });

    return {
      success: true,
      report,
    };

  } catch (error) {
    logger.error(`Error generating sales report:`, error);
    throw error;
  }
}

async function calculateConversionFunnel(data) {
  const { merchantId, startDate, endDate } = data;
  
  try {
    // This would integrate with analytics tracking (Google Analytics, custom tracking, etc.)
    // For now, we'll use order data as a proxy
    
    const start = new Date(startDate);
    const end = new Date(endDate);

    const orderStats = await Order.aggregate([
      {
        $match: {
          merchantId,
          createdAt: { $gte: start, $lte: end },
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        }
      },
    ]);

    const funnel = {
      visitors: 10000, // This would come from analytics tracking
      sessions: 5000,
      productViews: 2000,
      addToCarts: 800,
      checkoutStarted: 400,
      ordersCreated: 0,
      ordersCompleted: 0,
    };

    // Map order statuses to funnel steps
    for (const stat of orderStats) {
      funnel.ordersCreated += stat.count;
      
      if (['paid', 'processing', 'shipped', 'delivered'].includes(stat._id)) {
        funnel.ordersCompleted += stat.count;
      }
    }

    // Calculate conversion rates
    const conversionRates = {
      visitorToSession: (funnel.sessions / funnel.visitors * 100).toFixed(2),
      sessionToProductView: (funnel.productViews / funnel.sessions * 100).toFixed(2),
      productViewToAddCart: (funnel.addToCarts / funnel.productViews * 100).toFixed(2),
      addCartToCheckout: (funnel.checkoutStarted / funnel.addToCarts * 100).toFixed(2),
      checkoutToOrder: (funnel.ordersCreated / funnel.checkoutStarted * 100).toFixed(2),
      orderToCompletion: (funnel.ordersCompleted / funnel.ordersCreated * 100).toFixed(2),
      overallConversion: (funnel.ordersCompleted / funnel.visitors * 100).toFixed(2),
    };

    logger.info(`Conversion funnel calculated`, {
      merchantId,
      period: `${startDate} to ${endDate}`,
      overallConversion: conversionRates.overallConversion,
    });

    return {
      success: true,
      merchantId,
      period: { startDate, endDate },
      funnel,
      conversionRates,
    };

  } catch (error) {
    logger.error(`Error calculating conversion funnel:`, error);
    throw error;
  }
}

async function aggregateTopProducts(data) {
  const { merchantId, period = 30, limit = 20 } = data;
  
  try {
    const topProducts = await DailySales.getTopProducts(merchantId, period, limit);
    
    // Cache the results
    await CacheService.setConfig(`topProducts:${merchantId}:${period}d`, topProducts);

    logger.info(`Top products aggregated`, {
      merchantId,
      period,
      productCount: topProducts.length,
    });

    return {
      success: true,
      merchantId,
      period,
      products: topProducts,
    };

  } catch (error) {
    logger.error(`Error aggregating top products:`, error);
    throw error;
  }
}

// Helper functions
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function calculateSummary(data) {
  const summary = {
    totalOrders: 0,
    totalRevenue: 0,
    totalProducts: 0,
    totalCustomers: 0,
    averageOrderValue: 0,
    completionRate: 0,
  };

  for (const item of data) {
    summary.totalOrders += item.orders.total;
    summary.totalRevenue += item.revenue.gross;
    summary.totalProducts += item.products.sold;
    summary.totalCustomers += item.customers.total;
  }

  if (summary.totalOrders > 0) {
    summary.averageOrderValue = summary.totalRevenue / summary.totalOrders;
    summary.completionRate = (data.reduce((sum, item) => sum + item.orders.completed, 0) / summary.totalOrders) * 100;
  }

  return summary;
}

// Analytics service utility functions
export const AnalyticsService = {
  async updateDailySales(date, merchantId) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addAnalyticsJob('updateDailySales', { date, merchantId });
  },

  async calculateMerchantStats(merchantId, period = 30) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addAnalyticsJob('calculateMerchantStats', { merchantId, period });
  },

  async updateProductMetrics(productId) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addAnalyticsJob('updateProductMetrics', { productId });
  },

  async generateSalesReport(merchantId, startDate, endDate, groupBy = 'day') {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addAnalyticsJob('generateSalesReport', {
      merchantId,
      startDate,
      endDate,
      groupBy,
    });
  },

  async calculateConversionFunnel(merchantId, startDate, endDate) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addAnalyticsJob('calculateConversionFunnel', {
      merchantId,
      startDate,
      endDate,
    });
  },

  async aggregateTopProducts(merchantId, period = 30, limit = 20) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addAnalyticsJob('aggregateTopProducts', {
      merchantId,
      period,
      limit,
    });
  },
};