import express from 'express';
import Joi from 'joi';
import { optionalAuth, attachSession } from '../middleware/auth.js';
import { validate, validateQuery, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/error.js';
import CartController from '../controllers/CartController.js';

const router = express.Router();

// Attach session for guests
router.use(optionalAuth, attachSession);

router.get('/',
  validateQuery(Joi.object({ merchantId: Joi.string().required() })),
  asyncHandler(CartController.getCart)
);

router.post('/items',
  validate(Joi.object({
    merchantId: Joi.string().required(),
    sku: Joi.string().required(),
    quantity: Joi.number().integer().min(1).required(),
  })),
  asyncHandler(CartController.addItem)
);

router.put('/items/:sku',
  validate(Joi.object({
    merchantId: Joi.string().required(),
    quantity: Joi.number().integer().min(0).required(),
  })),
  asyncHandler(CartController.updateItem)
);

router.delete('/items/:sku',
  validateQuery(Joi.object({ merchantId: Joi.string().required() })),
  asyncHandler(CartController.removeItem)
);

export default router;


