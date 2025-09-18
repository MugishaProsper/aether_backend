import express from 'express';
import Joi from 'joi';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/error.js';
import PaymentController from '../controllers/PaymentController.js';

const router = express.Router();

router.post('/intent',
  authenticate,
  validate(Joi.object({
    orderId: Joi.string().required(),
    paymentMethodId: Joi.string(),
  })),
  asyncHandler(PaymentController.createIntent)
);

router.post('/confirm',
  authenticate,
  validate(Joi.object({ paymentIntentId: Joi.string().required() })),
  asyncHandler(PaymentController.confirmPayment)
);

export default router;


