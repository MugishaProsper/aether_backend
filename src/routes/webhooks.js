import express from 'express';
import WebhookController from '../controllers/WebhookController.js';

const router = express.Router();

// Stripe requires raw body for signature verification
router.post('/stripe',
  express.raw({ type: 'application/json' }),
  (req, res, next) => { req.rawBody = req.body; next(); },
  (req, res, next) => { try { req.body = JSON.parse(req.rawBody.toString()); } catch (_) { } next(); },
  (req, res, next) => WebhookController.stripe(req, res, next)
);

export default router;


