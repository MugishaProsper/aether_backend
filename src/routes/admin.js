import express from 'express';
import Joi from 'joi';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate, validateQuery, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/error.js';
import AdminController from '../controllers/AdminController.js';

const router = express.Router();

router.get('/users',
  authenticate,
  authorize('admin', 'superadmin'),
  asyncHandler(AdminController.listUsers)
);

router.put('/users/:id',
  authenticate,
  authorize('admin', 'superadmin'),
  validate(schemas.admin.userUpdate),
  asyncHandler(AdminController.updateUser)
);

router.get('/orders',
  authenticate,
  authorize('admin', 'superadmin'),
  asyncHandler(AdminController.listAllOrders)
);

router.get('/analytics',
  authenticate,
  authorize('admin', 'superadmin'),
  validateQuery(Joi.object({
    merchantId: Joi.string().required(),
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso(),
  })),
  asyncHandler(AdminController.analytics)
);

router.get('/sales',
  authenticate,
  authorize('admin', 'superadmin'),
  validateQuery(schemas.admin.salesQuery.keys({ merchantId: Joi.string().required() })),
  asyncHandler(AdminController.sales)
);

export default router;


