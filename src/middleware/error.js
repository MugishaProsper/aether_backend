import { config } from '../config/index.js';
import { logError, setupLogging } from '../config/logging.js';

const logger = setupLogging();

/**
 * Custom Error Classes
 */
export class AppError extends Error {
  constructor(message, statusCode, code = null, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

/**
 * Not Found Handler (404)
 */
export const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.originalUrl} not found`);
  next(error);
};

/**
 * Global Error Handler
 */
export const errorHandler = (err, req, res, next) => {
  // Log the error
  logError(err, req, {
    body: req.body,
    params: req.params,
    query: req.query,
  });

  // Handle specific error types
  let error = err;

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map(e => ({
      field: e.path,
      message: e.message,
      value: e.value,
    }));
    
    error = new ValidationError('Validation failed', details);
  }

  // Mongoose duplicate key errors
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    error = new ConflictError(`${field} '${value}' already exists`);
  }

  // Mongoose cast errors
  if (err.name === 'CastError') {
    error = new ValidationError(`Invalid ${err.path}: ${err.value}`);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AuthenticationError('Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    error = new AuthenticationError('Token expired');
  }

  // Redis connection errors
  if (err.code === 'ECONNREFUSED' && err.port === 6379) {
    error = new ServiceUnavailableError('Cache service unavailable');
  }

  // MongoDB connection errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongoServerError') {
    error = new ServiceUnavailableError('Database service unavailable');
  }

  // Stripe errors
  if (err.type && err.type.startsWith('Stripe')) {
    error = new AppError(
      'Payment processing error',
      err.statusCode || 400,
      'PAYMENT_ERROR',
      { type: err.type, code: err.code }
    );
  }

  // Multer errors (file upload)
  if (err.code === 'LIMIT_FILE_SIZE') {
    error = new ValidationError('File size too large');
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    error = new ValidationError('Too many files');
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    error = new ValidationError('Unexpected file field');
  }

  // Default to 500 server error if not operational
  if (!error.isOperational) {
    error = new AppError(
      'Something went wrong',
      500,
      'INTERNAL_ERROR'
    );
  }

  // Prepare error response
  const errorResponse = {
    error: error.message,
    code: error.code,
    timestamp: error.timestamp || new Date().toISOString(),
  };

  // Add details in development or for validation errors
  if (config.env === 'development' || error.statusCode === 400) {
    if (error.details) {
      errorResponse.details = error.details;
    }
    
    if (config.env === 'development' && error.stack) {
      errorResponse.stack = error.stack;
    }
  }

  // Add request ID for debugging
  if (req.requestId) {
    errorResponse.requestId = req.requestId;
  }

  // Send error response
  res.status(error.statusCode || 500).json(errorResponse);
};

/**
 * Async Error Handler Wrapper
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Error Handler for Promises
 */
export const handlePromiseRejection = (promise) => {
  return promise.catch(error => {
    logger.error('Unhandled promise rejection:', error);
    throw error;
  });
};

/**
 * Validation Error Helper
 */
export const createValidationError = (field, message, value = null) => {
  return new ValidationError('Validation failed', [{
    field,
    message,
    value,
  }]);
};

/**
 * Express-validator Error Formatter
 */
export const formatValidationErrors = (errors) => {
  const formattedErrors = errors.map(error => ({
    field: error.param,
    message: error.msg,
    value: error.value,
    location: error.location,
  }));

  return new ValidationError('Validation failed', formattedErrors);
};

/**
 * Mongoose Error Helper
 */
export const handleMongooseError = (error) => {
  if (error.name === 'ValidationError') {
    const details = Object.values(error.errors).map(e => ({
      field: e.path,
      message: e.message,
      value: e.value,
    }));
    
    return new ValidationError('Validation failed', details);
  }

  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    const value = error.keyValue[field];
    return new ConflictError(`${field} '${value}' already exists`);
  }

  if (error.name === 'CastError') {
    return new ValidationError(`Invalid ${error.path}: ${error.value}`);
  }

  return error;
};

/**
 * HTTP Status Code Helpers
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/**
 * Success Response Helper
 */
export const successResponse = (res, data, message = 'Success', statusCode = 200) => {
  const response = {
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  };

  return res.status(statusCode).json(response);
};

/**
 * Paginated Response Helper
 */
export const paginatedResponse = (res, data, pagination, message = 'Success') => {
  const response = {
    success: true,
    message,
    data,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      pages: Math.ceil(pagination.total / pagination.limit),
      hasNext: pagination.page < Math.ceil(pagination.total / pagination.limit),
      hasPrev: pagination.page > 1,
    },
    timestamp: new Date().toISOString(),
  };

  return res.status(200).json(response);
};