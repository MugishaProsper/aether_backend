import express from 'express';
import multer from 'multer';
import Joi from 'joi';
import { authenticate, authorize, authorizeMerchant, requirePermission } from '../middleware/auth.js';
import { validate, validateQuery, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/error.js';
import { activityLogger } from '../middleware/logging.js';
import ProductController from '../controllers/ProductController.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: './uploads/temp',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10, // Maximum 10 files
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
    }
  },
});

// Public routes
router.get('/',
  validateQuery(schemas.product.search.concat(schemas.pagination)),
  asyncHandler(ProductController.getProducts)
);

router.get('/featured',
  validateQuery(schemas.pagination),
  asyncHandler(ProductController.getFeaturedProducts)
);

router.get('/categories',
  asyncHandler(ProductController.getCategories)
);

router.get('/search',
  validateQuery(schemas.product.search.concat(schemas.pagination)),
  asyncHandler(ProductController.searchProducts)
);

router.get('/:productId',
  asyncHandler(ProductController.getProduct)
);

router.get('/:productId/variants/:sku',
  asyncHandler(ProductController.getProductVariant)
);

router.get('/:productId/related',
  validateQuery(schemas.pagination),
  asyncHandler(ProductController.getRelatedProducts)
);

// Merchant/Admin routes
router.post('/',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  validate(schemas.product.create),
  activityLogger('product_create'),
  asyncHandler(ProductController.createProduct)
);

router.put('/:productId',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  authorizeMerchant,
  validate(schemas.product.update),
  activityLogger('product_update'),
  asyncHandler(ProductController.updateProduct)
);

router.delete('/:productId',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  authorizeMerchant,
  activityLogger('product_delete'),
  asyncHandler(ProductController.deleteProduct)
);

router.post('/:productId/images',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  authorizeMerchant,
  upload.array('images', 10),
  activityLogger('product_images_upload'),
  asyncHandler(ProductController.uploadImages)
);

router.delete('/:productId/images/:imageId',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  authorizeMerchant,
  activityLogger('product_image_delete'),
  asyncHandler(ProductController.deleteImage)
);

router.patch('/:productId/status',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  authorizeMerchant,
  validate(Joi.object({ status: Joi.string().valid('draft', 'active', 'inactive', 'archived').required() })),
  activityLogger('product_status_change'),
  asyncHandler(ProductController.updateStatus)
);

router.patch('/:productId/featured',
  authenticate,
  authorize('admin', 'superadmin'),
  validate(Joi.object({ featured: Joi.boolean().required() })),
  activityLogger('product_featured_toggle'),
  asyncHandler(ProductController.toggleFeatured)
);

router.post('/:productId/variants',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  authorizeMerchant,
  validate(Joi.object({
    sku: Joi.string().required(),
    price: Joi.number().positive().required(),
    currency: Joi.string().valid('RWF', 'USD', 'EUR').default('RWF'),
    stock: Joi.number().integer().min(0).required(),
    attributes: Joi.object().pattern(Joi.string(), Joi.string()),
  })),
  activityLogger('product_variant_create'),
  asyncHandler(ProductController.addVariant)
);

router.put('/:productId/variants/:sku',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  authorizeMerchant,
  validate(Joi.object({
    price: Joi.number().positive(),
    stock: Joi.number().integer().min(0),
    attributes: Joi.object().pattern(Joi.string(), Joi.string()),
    isActive: Joi.boolean(),
  })),
  activityLogger('product_variant_update'),
  asyncHandler(ProductController.updateVariant)
);

router.delete('/:productId/variants/:sku',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  authorizeMerchant,
  activityLogger('product_variant_delete'),
  asyncHandler(ProductController.deleteVariant)
);

router.patch('/:productId/variants/:sku/stock',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  authorizeMerchant,
  validate(Joi.object({
    stock: Joi.number().integer().min(0).required(),
    operation: Joi.string().valid('set', 'increment', 'decrement').default('set'),
  })),
  activityLogger('product_stock_update'),
  asyncHandler(ProductController.updateStock)
);

// Analytics routes
router.get('/:productId/analytics',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  authorizeMerchant,
  validateQuery(schemas.dateRange),
  asyncHandler(ProductController.getProductAnalytics)
);

router.post('/:productId/view',
  asyncHandler(ProductController.recordView)
);

// Bulk operations
router.post('/bulk/status',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  validate(Joi.object({
    productIds: Joi.array().items(schemas.objectId).min(1).required(),
    status: Joi.string().valid('draft', 'active', 'inactive', 'archived').required(),
  })),
  activityLogger('product_bulk_status'),
  asyncHandler(ProductController.bulkUpdateStatus)
);

router.post('/bulk/delete',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  validate(Joi.object({
    productIds: Joi.array().items(schemas.objectId).min(1).required(),
  })),
  activityLogger('product_bulk_delete'),
  asyncHandler(ProductController.bulkDelete)
);

// Import/Export
router.post('/import',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  upload.single('file'),
  activityLogger('product_import'),
  asyncHandler(ProductController.importProducts)
);

router.get('/export',
  authenticate,
  authorize('seller', 'admin', 'superadmin'),
  authorizeMerchant,
  validateQuery(schemas.product.search),
  activityLogger('product_export'),
  asyncHandler(ProductController.exportProducts)
);

export default router;