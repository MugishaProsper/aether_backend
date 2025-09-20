import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  
  // Database
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/aether_db',
    options: {
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '10', 10),
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    },
  },
  
  // Metrics
  features: {
    enableMetrics: process.env.ENABLE_METRICS === 'true',
  },
  
  // Redis
  redis: {
    uri: process.env.REDIS_URI || 'redis://localhost:6379',
    cluster: process.env.REDIS_CLUSTER === 'true',
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'aether:',
    ttl: {
      session: parseInt(process.env.REDIS_SESSION_TTL || '3600', 10), // 1 hour
      cart: parseInt(process.env.REDIS_CART_TTL || '86400', 10), // 24 hours
      cache: parseInt(process.env.REDIS_CACHE_TTL || '300', 10), // 5 minutes
      reservation: parseInt(process.env.REDIS_RESERVATION_TTL || '900', 10), // 15 minutes
    },
  },
  
  // JWT
  jwt: {
    accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'your-access-secret-key',
    refreshTokenSecret: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key',
    accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },
  
  // CORS
  cors: {
    allowedOrigins: process.env.CORS_ORIGINS 
      ? process.env.CORS_ORIGINS.split(',') 
      : ['http://localhost:3000', 'http://localhost:3001'],
  },
  
  // File upload
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    destination: process.env.FILE_UPLOAD_DESTINATION || './uploads',
  },
  
  // AWS S3
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'eu-west-3',
    s3: {
      bucket: process.env.AWS_S3_BUCKET,
      publicUrl: process.env.AWS_S3_PUBLIC_URL,
    },
  },
  
  // Payment
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    apiVersion: '2025-09-09',
  },
  
  // Email
  email: {
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    },
    from: process.env.EMAIL_FROM || 'noreply@aether.com',
  },
  
  // Security
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000', 10), // 15 minutes
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },
  
  // Monitoring
  monitoring: {
    jaegerEndpoint: process.env.JAEGER_ENDPOINT,
    serviceName: process.env.SERVICE_NAME || 'aether_backend',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  
  // Features
  features: {
    enableMetrics: process.env.ENABLE_METRICS !== 'false',
    enableTracing: process.env.ENABLE_TRACING === 'true',
    enableCaching: process.env.ENABLE_CACHING !== 'false',
  },
};