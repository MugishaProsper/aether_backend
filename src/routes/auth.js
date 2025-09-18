import express from 'express';
import Joi from 'joi';
import { authenticate, optionalAuth, attachSession } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/error.js';
import { activityLogger } from '../middleware/logging.js';
import AuthController from '../controllers/AuthController.js';

const router = express.Router();

// Public routes
router.post('/register',
  validate(schemas.user.register),
  activityLogger('user_register'),
  asyncHandler(AuthController.register)
);

router.post('/login',
  validate(schemas.user.login),
  activityLogger('user_login'),
  asyncHandler(AuthController.login)
);

router.post('/refresh',
  asyncHandler(AuthController.refreshToken)
);

router.post('/forgot-password',
  validate(Joi.object({ email: schemas.email.required() })),
  asyncHandler(AuthController.forgotPassword)
);

router.post('/reset-password',
  validate(Joi.object({
    token: Joi.string().required(),
    password: schemas.password.required(),
  })),
  asyncHandler(AuthController.resetPassword)
);

router.post('/verify-email',
  validate(Joi.object({
    token: Joi.string().required(),
  })),
  asyncHandler(AuthController.verifyEmail)
);

// Protected routes
router.post('/logout',
  authenticate,
  activityLogger('user_logout'),
  asyncHandler(AuthController.logout)
);

router.post('/logout-all',
  authenticate,
  activityLogger('user_logout_all'),
  asyncHandler(AuthController.logoutAll)
);

router.get('/me',
  authenticate,
  asyncHandler(AuthController.getProfile)
);

router.put('/me',
  authenticate,
  validate(schemas.user.updateProfile),
  activityLogger('profile_update'),
  asyncHandler(AuthController.updateProfile)
);

router.put('/change-password',
  authenticate,
  validate(schemas.user.changePassword),
  activityLogger('password_change'),
  asyncHandler(AuthController.changePassword)
);

router.post('/resend-verification',
  authenticate,
  asyncHandler(AuthController.resendVerification)
);

// Session management
router.get('/sessions',
  authenticate,
  asyncHandler(AuthController.getSessions)
);

router.delete('/sessions/:sessionId',
  authenticate,
  asyncHandler(AuthController.revokeSession)
);

export default router;