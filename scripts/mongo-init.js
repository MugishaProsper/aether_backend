// MongoDB initialization script for development
db = db.getSiblingDB('ecommerce');

// Create collections with validation
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email', 'passwordHash', 'role'],
      properties: {
        email: { bsonType: 'string' },
        passwordHash: { bsonType: 'string' },
        role: { bsonType: 'string', enum: ['visitor', 'buyer', 'seller', 'admin', 'superadmin'] },
      }
    }
  }
});

db.createCollection('products', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['merchantId', 'title', 'variants'],
      properties: {
        merchantId: { bsonType: 'string' },
        title: { bsonType: 'string' },
        status: { bsonType: 'string', enum: ['draft', 'active', 'inactive', 'archived'] },
      }
    }
  }
});

db.createCollection('orders', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'merchantId', 'items', 'pricing', 'idempotencyKey'],
      properties: {
        status: { 
          bsonType: 'string', 
          enum: ['created', 'payment_pending', 'payment_failed', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'partially_refunded']
        },
      }
    }
  }
});

// Create indexes
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ role: 1 });
db.users.createIndex({ merchantId: 1 }, { sparse: true });

db.products.createIndex({ merchantId: 1, slug: 1 }, { unique: true });
db.products.createIndex({ status: 1 });
db.products.createIndex({ categories: 1 });
db.products.createIndex({ title: 'text', description: 'text' });

db.orders.createIndex({ userId: 1, status: 1, createdAt: -1 });
db.orders.createIndex({ merchantId: 1, status: 1, createdAt: -1 });
db.orders.createIndex({ idempotencyKey: 1 }, { unique: true });
db.orders.createIndex({ 'payment.paymentIntentId': 1 });

db.carts.createIndex({ userId: 1, merchantId: 1 });
db.carts.createIndex({ sessionId: 1, merchantId: 1 });
db.carts.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 2592000 }); // 30 days

db.idempotency.createIndex({ key: 1, userId: 1, sessionId: 1 }, { unique: true });
db.idempotency.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 }); // 24 hours

db.daily_sales.createIndex({ date: -1, merchantId: 1 });

print('MongoDB initialization completed successfully');