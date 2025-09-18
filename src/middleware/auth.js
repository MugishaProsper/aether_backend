import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { redis } from '../config/redis.js';
import { User } from '../models/index.js';
import { logSecurity, setupLogging } from '../config/logging.js';

const logger = setupLogging();

/**
 * JWT Authentication Middleware
 */
export const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'MISSING_TOKEN'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, config.jwt.accessTokenSecret);
    
    // Check if token is blacklisted (for logout/revocation)
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    if (isBlacklisted) {
      logSecurity('BLACKLISTED_TOKEN_USED', req, { tokenId: decoded.jti });
      return res.status(401).json({
        error: 'Token has been revoked',
        code: 'REVOKED_TOKEN'
      });
    }

    // Get user from database
    const user = await User.findById(decoded.userId);
    if (!user) {
      logSecurity('INVALID_USER_TOKEN', req, { userId: decoded.userId });
      return res.status(401).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if user account is active
    if (user.status !== 'active') {
      logSecurity('INACTIVE_USER_ACCESS', req, { userId: user._id, status: user.status });
      return res.status(401).json({
        error: 'Account is not active',
        code: 'ACCOUNT_INACTIVE'
      });
    }

    // Check if user account is locked
    if (user.isLocked) {
      logSecurity('LOCKED_USER_ACCESS', req, { userId: user._id });
      return res.status(401).json({
        error: 'Account is temporarily locked',
        code: 'ACCOUNT_LOCKED'
      });
    }

    // Attach user to request
    req.user = user;
    req.tokenPayload = decoded;
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      logSecurity('INVALID_TOKEN', req, { error: error.message });
      return res.status(401).json({
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    logger.error('Authentication error:', error);
    return res.status(500).json({
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Optional Authentication Middleware (for guest access)
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      // No token provided, continue as guest
      req.user = null;
      return next();
    }

    // Try to authenticate, but don't fail if token is invalid
    const decoded = jwt.verify(token, config.jwt.accessTokenSecret);
    const user = await User.findById(decoded.userId);
    
    if (user && user.status === 'active' && !user.isLocked) {
      req.user = user;
      req.tokenPayload = decoded;
    } else {
      req.user = null;
    }
    
    next();
  } catch (error) {
    // Authentication failed, continue as guest
    req.user = null;
    next();
  }
};

/**
 * Role-based Authorization Middleware
 */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const userRole = req.user.role;
    
    // Super admin has access to everything
    if (userRole === 'superadmin') {
      return next();
    }

    // Check if user role is in allowed roles
    if (!allowedRoles.includes(userRole)) {
      logSecurity('UNAUTHORIZED_ACCESS', req, { 
        userRole, 
        allowedRoles,
        userId: req.user._id 
      });
      
      return res.status(403).json({
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: allowedRoles,
        current: userRole
      });
    }

    next();
  };
};

/**
 * Merchant-specific Authorization
 */
export const authorizeMerchant = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  const userRole = req.user.role;
  const userMerchantId = req.user.merchantId;
  const requestedMerchantId = req.params.merchantId || req.body.merchantId || req.query.merchantId;

  // Super admin has access to all merchants
  if (userRole === 'superadmin') {
    return next();
  }

  // Admin role can access all merchants
  if (userRole === 'admin') {
    return next();
  }

  // Seller can only access their own merchant
  if (userRole === 'seller') {
    if (!userMerchantId) {
      return res.status(403).json({
        error: 'User is not associated with any merchant',
        code: 'NO_MERCHANT_ASSOCIATION'
      });
    }

    if (requestedMerchantId && userMerchantId !== requestedMerchantId) {
      logSecurity('MERCHANT_ACCESS_VIOLATION', req, {
        userId: req.user._id,
        userMerchantId,
        requestedMerchantId
      });
      
      return res.status(403).json({
        error: 'Access denied to this merchant',
        code: 'MERCHANT_ACCESS_DENIED'
      });
    }
  }

  next();
};

/**
 * Resource Ownership Authorization
 */
export const authorizeOwnership = (resourceUserIdField = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const userRole = req.user.role;
    const userId = req.user._id.toString();

    // Super admin and admin can access any resource
    if (['superadmin', 'admin'].includes(userRole)) {
      return next();
    }

    // Get resource user ID from request body, params, or attached resource
    let resourceUserId = req.body[resourceUserIdField] || 
                        req.params[resourceUserIdField] ||
                        req.resource?.[resourceUserIdField];

    // Convert ObjectId to string if necessary
    if (resourceUserId && typeof resourceUserId === 'object') {
      resourceUserId = resourceUserId.toString();
    }

    // Check if user owns the resource
    if (resourceUserId && userId !== resourceUserId) {
      logSecurity('RESOURCE_ACCESS_VIOLATION', req, {
        userId,
        resourceUserId,
        resource: req.originalUrl
      });
      
      return res.status(403).json({
        error: 'Access denied to this resource',
        code: 'RESOURCE_ACCESS_DENIED'
      });
    }

    next();
  };
};

/**
 * Rate Limiting by User
 */
export const userRateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  return async (req, res, next) => {
    if (!req.user) {
      return next(); // Skip rate limiting for unauthenticated requests
    }

    const userId = req.user._id.toString();
    const key = `rate_limit:user:${userId}`;
    
    try {
      const current = await redis.incr(key);
      
      if (current === 1) {
        await redis.expire(key, Math.ceil(windowMs / 1000));
      }
      
      if (current > maxRequests) {
        logSecurity('RATE_LIMIT_EXCEEDED', req, {
          userId,
          requests: current,
          limit: maxRequests
        });
        
        return res.status(429).json({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil(windowMs / 1000)
        });
      }
      
      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': Math.max(0, maxRequests - current),
        'X-RateLimit-Reset': new Date(Date.now() + windowMs).toISOString()
      });
      
      next();
    } catch (error) {
      logger.error('Rate limiting error:', error);
      next(); // Continue on rate limiting errors
    }
  };
};

/**
 * Session Management
 */
export const validateSession = async (req, res, next) => {
  if (!req.user) {
    return next();
  }

  const sessionId = req.tokenPayload?.sessionId;
  if (!sessionId) {
    return next();
  }

  try {
    const session = await redis.getSession(sessionId);
    if (!session || session.userId !== req.user._id.toString()) {
      logSecurity('INVALID_SESSION', req, {
        userId: req.user._id,
        sessionId
      });
      
      return res.status(401).json({
        error: 'Invalid session',
        code: 'INVALID_SESSION'
      });
    }

    // Update session last activity
    session.lastActivity = new Date();
    await redis.setSession(sessionId, session);
    
    req.session = session;
    next();
  } catch (error) {
    logger.error('Session validation error:', error);
    next();
  }
};

/**
 * Permission Checking Utilities
 */
export const hasPermission = (user, permission) => {
  const rolePermissions = {
    visitor: ['read:products', 'create:cart'],
    buyer: ['read:products', 'create:cart', 'create:orders', 'read:own_orders'],
    seller: [
      'read:products', 
      'create:products', 
      'update:own_products',
      'read:own_orders',
      'update:own_orders',
      'read:own_sales'
    ],
    admin: [
      'read:*',
      'create:*',
      'update:*',
      'delete:*'
    ],
    superadmin: ['*']
  };

  const userPermissions = rolePermissions[user.role] || [];
  
  return userPermissions.includes('*') || 
         userPermissions.includes(permission) ||
         userPermissions.some(p => p.endsWith(':*') && permission.startsWith(p.replace(':*', ':')));
};

/**
 * Permission-based Authorization Middleware
 */
export const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!hasPermission(req.user, permission)) {
      logSecurity('PERMISSION_DENIED', req, {
        userId: req.user._id,
        permission,
        userRole: req.user.role
      });
      
      return res.status(403).json({
        error: 'Permission denied',
        code: 'PERMISSION_DENIED',
        required: permission
      });
    }

    next();
  };
};

/**
 * Helper function to extract token from request
 */
function extractToken(req) {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check cookie
  const cookieToken = req.cookies?.accessToken;
  if (cookieToken) {
    return cookieToken;
  }

  // Check query parameter (not recommended for production)
  if (req.query.token) {
    return req.query.token;
  }

  return null;
}

/**
 * Middleware to attach user session ID for guest users
 */
export const attachSession = (req, res, next) => {
  if (!req.user) {
    // For guest users, create or get session ID from cookie
    let sessionId = req.cookies?.sessionId;
    
    if (!sessionId) {
      sessionId = generateSessionId();
      res.cookie('sessionId', sessionId, {
        httpOnly: true,
        secure: config.env === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
    }
    
    req.sessionId = sessionId;
  }
  
  next();
};

/**
 * Generate session ID
 */
function generateSessionId() {
  return 'sess_' + Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
}