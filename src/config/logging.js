import winston from 'winston';
import MongoDB from 'winston-mongodb';
import { config } from './index.js';

const { combine, timestamp, errors, json, printf, colorize } = winston.format;

let logger;

export const setupLogging = () => {
  if (logger) {
    return logger;
  }
  const logFormat = combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    json()
  );
  const consoleFormat = combine(
    colorize(),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    printf(({ timestamp, level, message, ...meta }) => {
      let msg = `${timestamp} [${level}]: ${message}`;
      if (Object.keys(meta).length > 0) {
        msg += ` ${JSON.stringify(meta)}`;
      }
      return msg;
    })
  );
  const transports = [
    // Console transport
    new winston.transports.Console({
      level: config.monitoring.logLevel,
      format: config.env === 'production' ? logFormat : consoleFormat,
      handleExceptions: true,
      handleRejections: true,
    }),
    // File transport for errors
    new winston.transports.File({
      filename: './logs/error.log',
      level: 'error',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: './logs/combined.log',
      format: logFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
  ];
  // Add MongoDB transport in production
  if (config.env === 'production' && config.mongodb.uri) {
    transports.push(
      new MongoDB.MongoDB({
        db: config.mongodb.uri,
        collection: 'logs',
        level: 'error',
        storeHost: true,
        capped: true,
        cappedSize: 10000000, // 10MB
        cappedMax: 10000,
        tryReconnect: true,
        decolorize: true,
      })
    );
  }
  logger = winston.createLogger({
    level: config.monitoring.logLevel,
    format: logFormat,
    transports,
    exitOnError: false,
  });
  // Handle uncaught exceptions and rejections
  logger.exceptions.handle(
    new winston.transports.File({ filename: './logs/exceptions.log' })
  );
  logger.rejections.handle(
    new winston.transports.File({ filename: './logs/rejections.log' })
  );
  return logger;
};

// Request ID generator for correlation
export const generateRequestId = () => {
  return Math.random().toString(36).substr(2, 9);
};

// Structured logging helpers
export const logRequest = (req, res, responseTime) => {
  const logger = setupLogging();  
  logger.info('HTTP Request', {
    method: req.method,
    url: req.originalUrl,
    statusCode: res.statusCode,
    responseTime: `${responseTime}ms`,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    userId: req.user?.id,
    requestId: req.requestId,
  });
};

export const logError = (error, req = null, context = {}) => {
  const logger = setupLogging();  
  logger.error('Application Error', {
    error: error.message,
    stack: error.stack,
    url: req?.originalUrl,
    method: req?.method,
    userId: req?.user?.id,
    requestId: req?.requestId,
    ...context,
  });
};

export const logSecurity = (event, req, details = {}) => {
  const logger = setupLogging();  
  logger.warn('Security Event', {
    event,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    url: req.originalUrl,
    method: req.method,
    requestId: req.requestId,
    ...details,
  });
};

export const logBusinessEvent = (event, data = {}) => {
  const logger = setupLogging();
  logger.info('Business Event', {
    event,
    timestamp: new Date().toISOString(),
    ...data,
  });
};