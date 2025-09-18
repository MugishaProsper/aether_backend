import express from 'express';
import Joi from 'joi';
import { authenticate } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/error.js';
import OrderController from '../controllers/OrderController.js';

const router = express.Router();

router.post('/',
  authenticate,
  validate(schemas.order.create.keys({ merchantId: Joi.string().required() })),
  asyncHandler(OrderController.createOrder)
);

router.get('/',
  authenticate,
  asyncHandler(OrderController.listOrders)
);

router.get('/:id',
  authenticate,
  asyncHandler(OrderController.getOrder)
);

router.post('/:id/cancel',
  authenticate,
  asyncHandler(OrderController.cancelOrder)
);

export default router;


