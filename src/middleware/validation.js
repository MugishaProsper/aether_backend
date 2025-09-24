import Joi from 'joi';
import { ValidationError } from './error.js';

/**
 * Joi validation middleware
 */
export const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: false,
    });

    if (error) {
      const details = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value,
      }));

      return next(new ValidationError('Validation failed', details));
    }

    // Replace the property with the validated and sanitized value
    req[property] = value;
    next();
  };
};

// Define base schemas first
const baseSchemas = {
  // MongoDB ObjectId validation
  objectId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).messages({
    'string.pattern.base': 'Invalid ID format',
  }),

  // Email validation
  email: Joi.string().email().lowercase().trim().messages({
    'string.email': 'Invalid email format',
  }),

  // Password validation
  password: Joi.string()
    .min(8)
    .max(128),

  // Phone number validation (Rwanda format)
  phone: Joi.string()
    .pattern(/^\+?250[0-9]{9}$/)
    .messages({
      'string.pattern.base': 'Invalid phone number format (use Rwanda format: +250XXXXXXXXX)',
    }),

  // Pagination
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string().default('-createdAt'),
    search: Joi.string().max(100),
  }),

  // Date range
  dateRange: Joi.object({
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')),
  }),
};

/**
 * Common validation schemas
 */
export const schemas = {
  ...baseSchemas,

  // User schemas
  user: {
    register: Joi.object({
      email: baseSchemas.email.required(),
      password: baseSchemas.password.required(),
      fullname: Joi.string().min(2).max(100).trim().required(),
      phone: baseSchemas.phone,
      role: Joi.string().valid('BUYER', 'SELLER').default('BUYER'),
    }),

    login: Joi.object({
      email: baseSchemas.email.required(),
      password: Joi.string().required(),
      rememberMe: Joi.boolean().default(false),
    }),

    updateProfile: Joi.object({
      name: Joi.string().min(2).max(100).trim(),
      phone: baseSchemas.phone,
      address: Joi.object({
        street: Joi.string().max(200),
        city: Joi.string().max(100),
        state: Joi.string().max(100),
        zipCode: Joi.string().max(20),
        country: Joi.string().max(100).default('Rwanda'),
      }),
    }),

    changePassword: Joi.object({
      currentPassword: Joi.string().required(),
      newPassword: baseSchemas.password.required(),
      confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({
        'any.only': 'Passwords do not match',
      }),
    }),
  },

  // Product schemas
  product: {
    create: Joi.object({
      title: Joi.string().min(3).max(200).trim().required(),
      description: Joi.string().min(10).max(5000).trim().required(),
      shortDescription: Joi.string().max(500).trim(),
      categories: Joi.array().items(Joi.string().trim()).min(1).required(),
      tags: Joi.array().items(Joi.string().trim()),
      variants: Joi.array().items(Joi.object({
        sku: Joi.string().trim().required(),
        price: Joi.number().positive().required(),
        currency: Joi.string().valid('RWF', 'USD', 'EUR').default('RWF'),
        stock: Joi.number().integer().min(0).required(),
        attributes: Joi.object().pattern(Joi.string(), Joi.string()),
        dimensions: Joi.object({
          weight: Joi.number().positive(),
          length: Joi.number().positive(),
          width: Joi.number().positive(),
          height: Joi.number().positive(),
        }),
      })).min(1).required(),
      specifications: Joi.object().pattern(Joi.string(), Joi.string()),
      shipping: Joi.object({
        weight: Joi.number().positive(),
        dimensions: Joi.object({
          length: Joi.number().positive(),
          width: Joi.number().positive(),
          height: Joi.number().positive(),
        }),
        freeShipping: Joi.boolean().default(false),
        shippingCost: Joi.number().min(0).default(0),
      }),
    }),

    update: Joi.object({
      title: Joi.string().min(3).max(200).trim(),
      description: Joi.string().min(10).max(5000).trim(),
      shortDescription: Joi.string().max(500).trim(),
      categories: Joi.array().items(Joi.string().trim()).min(1),
      tags: Joi.array().items(Joi.string().trim()),
      variants: Joi.array().items(Joi.object({
        sku: Joi.string().trim().required(),
        price: Joi.number().positive().required(),
        currency: Joi.string().valid('RWF', 'USD', 'EUR').default('RWF'),
        stock: Joi.number().integer().min(0).required(),
        attributes: Joi.object().pattern(Joi.string(), Joi.string()),
        dimensions: Joi.object({
          weight: Joi.number().positive(),
          length: Joi.number().positive(),
          width: Joi.number().positive(),
          height: Joi.number().positive(),
        }),
        isActive: Joi.boolean().default(true),
      })),
      specifications: Joi.object().pattern(Joi.string(), Joi.string()),
      status: Joi.string().valid('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'),
      featured: Joi.boolean(),
    }),

    search: Joi.object({
      q: Joi.string().max(100),
      categories: Joi.array().items(Joi.string()),
      minPrice: Joi.number().min(0),
      maxPrice: Joi.number().min(Joi.ref('minPrice')),
      inStock: Joi.boolean(),
      featured: Joi.boolean(),
      merchantId: Joi.string(),
    }),
  },

  // Cart schemas
  cart: {
    addItem: Joi.object({
      sku: Joi.string().required(),
      quantity: Joi.number().integer().min(1).required(),
    }),

    updateItem: Joi.object({
      quantity: Joi.number().integer().min(0).required(),
    }),

    applyCoupon: Joi.object({
      couponCode: Joi.string().uppercase().trim().required(),
    }),

    updateShipping: Joi.object({
      name: Joi.string().min(2).max(100).trim().required(),
      phone: baseSchemas.phone.required(),
      street: Joi.string().max(200).required(),
      city: Joi.string().max(100).required(),
      state: Joi.string().max(100),
      zipCode: Joi.string().max(20),
      country: Joi.string().max(100).default('Rwanda'),
    }),
  },

  // Order schemas
  order: {
    create: Joi.object({
      cartId: baseSchemas.objectId,
      shippingAddress: Joi.object({
        name: Joi.string().min(2).max(100).trim().required(),
        phone: baseSchemas.phone.required(),
        street: Joi.string().max(200).required(),
        city: Joi.string().max(100).required(),
        state: Joi.string().max(100),
        zipCode: Joi.string().max(20),
        country: Joi.string().max(100).default('Rwanda'),
      }).required(),
      billingAddress: Joi.object({
        name: Joi.string().min(2).max(100).trim().required(),
        email: baseSchemas.email.required(),
        phone: baseSchemas.phone,
        street: Joi.string().max(200).required(),
        city: Joi.string().max(100).required(),
        state: Joi.string().max(100),
        zipCode: Joi.string().max(20),
        country: Joi.string().max(100).default('Rwanda'),
      }),
      paymentMethod: Joi.string().valid('STRIPE', 'PAYPAL', 'BANK_TRANSFER', 'CASH_ON_DELIVERY').required(),
      notes: Joi.string().max(500),
    }),

    updateStatus: Joi.object({
      status: Joi.string().valid(
        'CREATED',
        'PAYMENT_PENDING',
        'PAYMENT_FAILED',
        'PAID',
        'PROCESSING',
        'SHIPPED',
        'DELIVERED',
        'CANCELLED',
        'REFUNDED'
      ).required(),
      notes: Joi.string().max(500),
    }),

    addTracking: Joi.object({
      carrier: Joi.string().max(100).required(),
      trackingNumber: Joi.string().max(100).required(),
      estimatedDelivery: Joi.date().iso(),
    }),
  },

  // Payment schemas
  payment: {
    createIntent: Joi.object({
      orderId: baseSchemas.objectId.required(),
      paymentMethodId: Joi.string(),
      savePaymentMethod: Joi.boolean().default(false),
    }),

    confirmPayment: Joi.object({
      paymentIntentId: Joi.string().required(),
      paymentMethodId: Joi.string(),
    }),
  },

  // Admin schemas
  admin: {
    userUpdate: Joi.object({
      role: Joi.string().valid('BUYER', 'SELLER', 'ADMIN', 'SUPERADMIN'),
      status: Joi.string().valid('ACTIVE', 'SUSPENDED', 'DELETED'),
      merchantId: Joi.string(),
    }),

    salesQuery: Joi.object({
      merchantId: Joi.string(),
      startDate: Joi.date().iso(),
      endDate: Joi.date().iso().min(Joi.ref('startDate')),
      groupBy: Joi.string().valid('DAY', 'WEEK', 'MONTH').default('DAY'),
    }),
  },
};

/**
 * Validate request parameters
 */
export const validateParams = (schema) => validate(schema, 'params');

/**
 * Validate query parameters
 */
export const validateQuery = (schema) => validate(schema, 'query');

/**
 * Validate request headers
 */
export const validateHeaders = (schema) => validate(schema, 'headers');

/**
 * Custom validation functions
 */
export const customValidations = {
  // Check if user exists
  userExists: async (userId) => {
    const User = (await import('../models/index.js')).User;
    const user = await User.findById(userId);
    if (!user) {
      throw new ValidationError('User not found');
    }
    return user;
  },

  // Check if product exists and user has access
  productAccess: async (productId, userId, userRole) => {
    const Product = (await import('../models/index.js')).Product;
    const User = (await import('../models/index.js')).User;

    const product = await Product.findById(productId);
    if (!product) {
      throw new ValidationError('Product not found');
    }

    const user = await User.findById(userId);
    if (userRole === 'seller' && product.merchantId !== user.merchantId) {
      throw new ValidationError('Access denied to this product');
    }

    return product;
  },

  // Check if SKU is unique
  skuUnique: async (sku, excludeProductId = null) => {
    const Product = (await import('../models/index.js')).Product;
    const query = { 'variants.sku': sku };

    if (excludeProductId) {
      query._id = { $ne: excludeProductId };
    }

    const existingProduct = await Product.findOne(query);
    if (existingProduct) {
      throw new ValidationError(`SKU '${sku}' already exists`);
    }
  },

  // Validate idempotency key format
  idempotencyKey: (key) => {
    const keyRegex = /^[a-zA-Z0-9_-]{10,100}$/;
    if (!keyRegex.test(key)) {
      throw new ValidationError('Invalid idempotency key format');
    }
  },
};

/**
 * Sanitization helpers
 */
export const sanitize = {
  // Remove HTML tags
  stripHtml: (text) => {
    return text.replace(/<[^>]*>/g, '');
  },

  // Normalize phone number
  normalizePhone: (phone) => {
    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');

    // Add country code if missing
    if (digits.length === 9) {
      return `+250${digits}`;
    } else if (digits.length === 12 && digits.startsWith('250')) {
      return `+${digits}`;
    }

    return phone;
  },

  // Normalize email
  normalizeEmail: (email) => {
    return email.toLowerCase().trim();
  },

  // Create slug from title
  createSlug: (title) => {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  },
};