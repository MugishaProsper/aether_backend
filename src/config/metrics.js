import client from 'prom-client';
import { config } from './index.js';

let metricsSetup = false;
let register;

// Metrics instances
let httpRequestDuration;
let httpRequestTotal;
let httpRequestSize;
let httpResponseSize;
let activeConnections;
let databaseQueryDuration;
let redisOperationDuration;
let orderMetrics;
let paymentMetrics;
let inventoryMetrics;
let cacheMetrics;

export const setupMetrics = () => {
  if (metricsSetup) {
    return { register };
  }

  // Create a Registry
  register = new client.Registry();

  // Add default metrics
  client.collectDefaultMetrics({
    register,
    prefix: 'aether_',
    gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
  });

  // HTTP Metrics
  httpRequestDuration = new client.Histogram({
    name: 'aether_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
    registers: [register],
  });

  httpRequestTotal = new client.Counter({
    name: 'aether_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });

  httpRequestSize = new client.Histogram({
    name: 'aether_http_request_size_bytes',
    help: 'Size of HTTP requests in bytes',
    labelNames: ['method', 'route'],
    buckets: [100, 1000, 10000, 100000, 1000000],
    registers: [register],
  });

  httpResponseSize = new client.Histogram({
    name: 'aether_http_response_size_bytes',
    help: 'Size of HTTP responses in bytes',
    labelNames: ['method', 'route'],
    buckets: [100, 1000, 10000, 100000, 1000000],
    registers: [register],
  });

  activeConnections = new client.Gauge({
    name: 'aether_active_connections',
    help: 'Number of active connections',
    registers: [register],
  });

  // Database Metrics
  databaseQueryDuration = new client.Histogram({
    name: 'aether_database_query_duration_seconds',
    help: 'Duration of database queries in seconds',
    labelNames: ['operation', 'collection'],
    buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
    registers: [register],
  });

  // Redis Metrics
  redisOperationDuration = new client.Histogram({
    name: 'aether_redis_operation_duration_seconds',
    help: 'Duration of Redis operations in seconds',
    labelNames: ['operation'],
    buckets: [0.001, 0.01, 0.1, 0.5, 1],
    registers: [register],
  });

  cacheMetrics = {
    hits: new client.Counter({
      name: 'aether_cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_type'],
      registers: [register],
    }),
    misses: new client.Counter({
      name: 'aether_cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_type'],
      registers: [register],
    }),
  };

  // Business Metrics
  orderMetrics = {
    created: new client.Counter({
      name: 'aether_orders_created_total',
      help: 'Total number of orders created',
      labelNames: ['merchant_id'],
      registers: [register],
    }),
    completed: new client.Counter({
      name: 'aether_orders_completed_total',
      help: 'Total number of orders completed',
      labelNames: ['merchant_id'],
      registers: [register],
    }),
    cancelled: new client.Counter({
      name: 'aether_orders_cancelled_total',
      help: 'Total number of orders cancelled',
      labelNames: ['merchant_id'],
      registers: [register],
    }),
    value: new client.Histogram({
      name: 'aether_order_value_rwf',
      help: 'Order value in RWF',
      labelNames: ['merchant_id'],
      buckets: [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000],
      registers: [register],
    }),
  };

  paymentMetrics = {
    attempts: new client.Counter({
      name: 'aether_payment_attempts_total',
      help: 'Total number of payment attempts',
      labelNames: ['provider', 'status'],
      registers: [register],
    }),
    duration: new client.Histogram({
      name: 'aether_payment_duration_seconds',
      help: 'Payment processing duration in seconds',
      labelNames: ['provider'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
      registers: [register],
    }),
  };

  inventoryMetrics = {
    reservations: new client.Counter({
      name: 'aether_inventory_reservations_total',
      help: 'Total number of inventory reservations',
      labelNames: ['status'], // success, failed
      registers: [register],
    }),
    stock: new client.Gauge({
      name: 'aether_inventory_stock_level',
      help: 'Current stock level for products',
      labelNames: ['sku', 'merchant_id'],
      registers: [register],
    }),
  };

  metricsSetup = true;
  return { register };
};

// Middleware to collect HTTP metrics
export const metricsMiddleware = (req, res, next) => {
  if (!config.features.enableMetrics) {
    return next();
  }
  const start = Date.now();  
  // Track active connections
  activeConnections.inc();  
  // Track request size
  if (req.get('content-length')) {
    const requestSize = parseInt(req.get('content-length'), 10);
    httpRequestSize.observe(
      { method: req.method, route: req.route?.path || req.path },
      requestSize
    );
  }
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode,
    };
    // Record metrics
    httpRequestDuration.observe(labels, duration);
    httpRequestTotal.inc(labels);    
    // Track response size
    if (res.get('content-length')) {
      const responseSize = parseInt(res.get('content-length'), 10);
      httpResponseSize.observe(
        { method: req.method, route },
        responseSize
      );
    }
    // Decrease active connections
    activeConnections.dec();
  });
  next();
};

// Helper functions to record business metrics
export const recordOrderMetric = (event, merchantId, value = null) => {
  if (!config.features.enableMetrics || !orderMetrics[event]) {
    return;
  }
  if (event === 'value' && value !== null) {
    orderMetrics.value.observe({ merchant_id: merchantId }, value);
  } else {
    orderMetrics[event].inc({ merchant_id: merchantId });
  }
};

export const recordPaymentMetric = (event, provider, status = null, duration = null) => {
  if (!config.features.enableMetrics) {
    return;
  }
  if (event === 'attempts') {
    paymentMetrics.attempts.inc({ provider, status });
  } else if (event === 'duration' && duration !== null) {
    paymentMetrics.duration.observe({ provider }, duration);
  }
};

export const recordInventoryMetric = (event, data) => {
  if (!config.features.enableMetrics) {
    return;
  }
  if (event === 'reservation') {
    inventoryMetrics.reservations.inc({ status: data.status });
  } else if (event === 'stock') {
    inventoryMetrics.stock.set(
      { sku: data.sku, merchant_id: data.merchantId },
      data.stock
    );
  }
};

export const recordCacheMetric = (event, cacheType) => {
  if (!config.features.enableMetrics) {
    return;
  }
  if (cacheMetrics[event]) {
    cacheMetrics[event].inc({ cache_type: cacheType });
  }
};

export const recordDatabaseMetric = (operation, collection, duration) => {
  if (!config.features.enableMetrics) {
    return;
  }
  databaseQueryDuration.observe({ operation, collection }, duration / 1000);
};

export const recordRedisMetric = (operation, duration) => {
  if (!config.features.enableMetrics) {
    return;
  }
  redisOperationDuration.observe({ operation }, duration / 1000);
};

// Export metrics instances for direct access
export {
  httpRequestDuration,
  httpRequestTotal,
  orderMetrics,
  paymentMetrics,
  inventoryMetrics,
  cacheMetrics,
};