import { generateRequestId, logRequest, setupLogging } from '../config/logging.js';

const logger = setupLogging();

/**
 * Request logging middleware
 */
export const requestLogger = (req, res, next) => {
  // Generate unique request ID
  req.requestId = generateRequestId();
  
  // Add request ID to response headers
  res.set('X-Request-ID', req.requestId);
  
  // Log request start
  const startTime = Date.now();
  
  // Log request details
  logger.info('Request started', {
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
  });

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const responseTime = Date.now() - startTime;
    
    // Log response
    logRequest(req, res, responseTime);
    
    // Call original end method
    originalEnd.call(res, chunk, encoding);
  };

  next();
};

/**
 * Request body logging middleware (for debugging)
 */
export const bodyLogger = (req, res, next) => {
  if (req.body && Object.keys(req.body).length > 0) {
    // Filter out sensitive fields
    const sensitiveFields = ['password', 'passwordHash', 'token', 'secret', 'key'];
    const filteredBody = { ...req.body };
    
    sensitiveFields.forEach(field => {
      if (filteredBody[field]) {
        filteredBody[field] = '[FILTERED]';
      }
    });

    logger.debug('Request body', {
      requestId: req.requestId,
      body: filteredBody,
    });
  }

  next();
};

/**
 * Response time middleware
 */
export const responseTime = (req, res, next) => {
  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const time = diff[0] * 1000 + diff[1] * 1e-6; // Convert to milliseconds
    
    res.set('X-Response-Time', `${time.toFixed(2)}ms`);
  });

  next();
};

/**
 * API version logging
 */
export const apiVersionLogger = (version) => {
  return (req, res, next) => {
    res.set('X-API-Version', version);
    
    logger.debug('API version', {
      requestId: req.requestId,
      version,
      endpoint: req.originalUrl,
    });

    next();
  };
};

/**
 * User activity logging
 */
export const activityLogger = (action) => {
  return (req, res, next) => {
    // Log after response is sent
    res.on('finish', () => {
      if (req.user && res.statusCode < 400) {
        logger.info('User activity', {
          userId: req.user._id,
          action,
          resource: req.originalUrl,
          method: req.method,
          statusCode: res.statusCode,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          timestamp: new Date().toISOString(),
        });
      }
    });

    next();
  };
};

/**
 * Slow request logger
 */
export const slowRequestLogger = (thresholdMs = 1000) => {
  return (req, res, next) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      
      if (responseTime > thresholdMs) {
        logger.warn('Slow request detected', {
          requestId: req.requestId,
          method: req.method,
          url: req.originalUrl,
          responseTime: `${responseTime}ms`,
          statusCode: res.statusCode,
          userId: req.user?._id,
        });
      }
    });

    next();
  };
};

/**
 * Error request logger
 */
export const errorRequestLogger = (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      logger.error('Error response', {
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        userId: req.user?._id,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });
    }
  });

  next();
};

/**
 * Database query logger
 */
export const queryLogger = (req, res, next) => {
  // Store original mongoose methods to track queries
  if (req.user) {
    req.queryCount = 0;
    req.queryTime = 0;
  }

  next();
};

/**
 * Business event logger
 */
export const businessEventLogger = (event, getData) => {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const eventData = typeof getData === 'function' ? getData(req, res) : getData || {};
        
        logger.info('Business event', {
          event,
          userId: req.user?._id,
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
          ...eventData,
        });
      }
    });

    next();
  };
};

/**
 * Security event logger
 */
export const securityEventLogger = (event, getData) => {
  return (req, res, next) => {
    const eventData = typeof getData === 'function' ? getData(req, res) : getData || {};
    
    logger.warn('Security event', {
      event,
      userId: req.user?._id,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
      ...eventData,
    });

    next();
  };
};

/**
 * Performance metrics logger
 */
export const performanceLogger = (req, res, next) => {
  const startTime = process.hrtime.bigint();
  const startMemory = process.memoryUsage();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const endMemory = process.memoryUsage();
    
    const responseTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;

    if (responseTime > 500 || Math.abs(memoryDelta) > 10 * 1024 * 1024) { // Log slow requests or high memory usage
      logger.info('Performance metrics', {
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl,
        responseTime: `${responseTime.toFixed(2)}ms`,
        memoryDelta: `${(memoryDelta / 1024 / 1024).toFixed(2)}MB`,
        heapUsed: `${(endMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        statusCode: res.statusCode,
      });
    }
  });

  next();
};