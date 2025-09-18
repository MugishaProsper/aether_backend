import mongoose from 'mongoose';
import { config } from './index.js';
import { setupLogging } from './logging.js';

const logger = setupLogging();

class DatabaseConnection {
  constructor() {
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) {
      return;
    }

    try {
      // Configure mongoose
      mongoose.set('strictQuery', true);

      // Connection event handlers
      mongoose.connection.on('connected', () => {
        logger.info('MongoDB connected successfully');
        this.isConnected = true;
      });

      mongoose.connection.on('error', (error) => {
        logger.error('MongoDB connection error:', error);
        this.isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
        this.isConnected = false;
      });

      // Connect to MongoDB
      await mongoose.connect(config.mongodb.uri, {
        ...config.mongodb.options,
        bufferCommands: false,
      });

      // Create indexes
      await this.createIndexes();

    } catch (error) {
      logger.error('Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  async disconnect() {
    if (!this.isConnected) {
      return;
    }

    try {
      await mongoose.connection.close();
      this.isConnected = false;
      logger.info('MongoDB disconnected successfully');
    } catch (error) {
      logger.error('Error disconnecting from MongoDB:', error);
      throw error;
    }
  }

  async createIndexes() {
    try {
      // Helper function to create index with error handling
      const createIndexSafely = async (collection, indexSpec, options = {}) => {
        try {
          await collection.createIndex(indexSpec, options);
        } catch (error) {
          if (error.code === 86 || error.codeName === 'IndexKeySpecsConflict') {
            logger.warn(`Index already exists or conflicts: ${JSON.stringify(indexSpec)}`);
          } else {
            throw error;
          }
        }
      };

      // User indexes
      await createIndexSafely(mongoose.connection.collection('users'), { email: 1 }, { unique: true });
      await createIndexSafely(mongoose.connection.collection('users'), { role: 1 });
      await createIndexSafely(mongoose.connection.collection('users'), { merchantId: 1 }, { sparse: true });

      // Product indexes
      await createIndexSafely(mongoose.connection.collection('products'), { merchantId: 1, slug: 1 }, { unique: true });
      await createIndexSafely(mongoose.connection.collection('products'), { status: 1 });
      await createIndexSafely(mongoose.connection.collection('products'), { categories: 1 });
      await createIndexSafely(mongoose.connection.collection('products'), { featured: 1, status: 1 });
      await createIndexSafely(mongoose.connection.collection('products'), { status: 1, createdAt: -1 });
      await createIndexSafely(mongoose.connection.collection('products'), { 'analytics.sales': -1 });
      await createIndexSafely(mongoose.connection.collection('products'), { 'analytics.rating.average': -1 });

      // Text index for search
      await createIndexSafely(mongoose.connection.collection('products'),
        { title: 'text', description: 'text', specifications: 'text', tags: 'text' },
        {
          weights: { title: 10, tags: 5, description: 3, specifications: 1 },
          name: 'product_text_index'
        }
      );

      // Order indexes
      await createIndexSafely(mongoose.connection.collection('orders'), { userId: 1, status: 1, createdAt: -1 });
      await createIndexSafely(mongoose.connection.collection('orders'), { merchantId: 1, status: 1, createdAt: -1 });
      await createIndexSafely(mongoose.connection.collection('orders'), { orderNumber: 1 }, { unique: true });
      await createIndexSafely(mongoose.connection.collection('orders'), { idempotencyKey: 1 }, { unique: true });
      await createIndexSafely(mongoose.connection.collection('orders'), { 'payment.paymentIntentId': 1 });
      await createIndexSafely(mongoose.connection.collection('orders'), { status: 1, createdAt: -1 });
      await createIndexSafely(mongoose.connection.collection('orders'), { createdAt: -1 });

      // Cart indexes
      await createIndexSafely(mongoose.connection.collection('carts'), { userId: 1, merchantId: 1 });
      await createIndexSafely(mongoose.connection.collection('carts'), { sessionId: 1, merchantId: 1 });
      await createIndexSafely(mongoose.connection.collection('carts'), { status: 1, updatedAt: -1 });
      await createIndexSafely(mongoose.connection.collection('carts'), { updatedAt: 1 }, { expireAfterSeconds: 86400 * 30 }); // 30 days

      // Idempotency indexes
      await createIndexSafely(mongoose.connection.collection('idempotency'),
        { key: 1, userId: 1, sessionId: 1 },
        {
          unique: true,
          partialFilterExpression: {
            $or: [
              { userId: { $exists: true } },
              { sessionId: { $exists: true } }
            ]
          }
        }
      );
      await createIndexSafely(mongoose.connection.collection('idempotency'), { endpoint: 1, method: 1 });
      await createIndexSafely(mongoose.connection.collection('idempotency'), { createdAt: -1 });
      await createIndexSafely(mongoose.connection.collection('idempotency'), { expiresAt: 1 }, { expireAfterSeconds: 0 });

      // Sales aggregation indexes
      await createIndexSafely(mongoose.connection.collection('daily_sales'), { date: 1, merchantId: 1 }, { unique: true });
      await createIndexSafely(mongoose.connection.collection('daily_sales'), { date: -1, merchantId: 1 });
      await createIndexSafely(mongoose.connection.collection('daily_sales'), { merchantId: 1, date: -1 });
      await createIndexSafely(mongoose.connection.collection('daily_sales'), { 'metrics.revenue.gross': -1 });

      logger.info('Database indexes created successfully');
    } catch (error) {
      logger.error('Error creating database indexes:', error);
      // Don't throw error for index creation failures in development
      if (config.env === 'production') {
        throw error;
      }
    }
  }

  getConnection() {
    return mongoose.connection;
  }

  isHealthy() {
    return this.isConnected && mongoose.connection.readyState === 1;
  }
}

// Export singleton instance
export const connectMongoDB = new DatabaseConnection().connect.bind(new DatabaseConnection());
export const mongoConnection = new DatabaseConnection();