# Aether Backend - Production Ready

A horizontally scalable, production-ready backend built with Node.js, MongoDB, Redis, and Docker. Features comprehensive role-based access control, inventory management, payment processing, and real-time analytics.

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌──────────────┐    ┌─────────────────┐
│   Load Balancer │    │   API Gateway │    │   Microservices │
│     (Nginx)     │───▶│   (Express)   │───▶│    Architecture │
└─────────────────┘    └──────────────┘    └─────────────────┘
                              │
                              ▼
┌─────────────────┬──────────────────┬─────────────────┬──────────────────┐
│  Auth Service   │ Product Service  │  Order Service  │ Payment Service  │
│                 │                  │                 │                  │
│ • JWT Tokens    │ • CRUD Ops       │ • Checkout Flow │ • Stripe Integ.  │
│ • RBAC          │ • Search/Filter  │ • Inventory Res │ • Webhook Handle │
│ • Session Mgmt  │ • Image Upload   │ • Status Mgmt   │ • Refund Process │
└─────────────────┴──────────────────┴─────────────────┴──────────────────┘
                              │
                              ▼
┌─────────────────┬──────────────────┬─────────────────┬──────────────────┐
│    MongoDB      │      Redis       │   BullMQ        │   Prometheus     │
│                 │                  │                 │                  │
│ • User Data     │ • Session Store  │ • Background    │ • Metrics        │
│ • Products      │ • Cache Layer    │   Jobs          │ • Monitoring     │
│ • Orders        │ • Inventory Res  │ • Email Queue   │ • Alerting       │
│ • Analytics     │ • Rate Limiting  │ • Image Proc    │ • Dashboards     │
└─────────────────┴──────────────────┴─────────────────┴──────────────────┘
```

## 🚀 Features

### Core Functionality
- **Multi-tenant Architecture**: Support for multiple merchants with isolated data
- **Role-Based Access Control**: Visitor, Buyer, Seller, Admin, Super Admin roles
- **Inventory Management**: Real-time stock tracking with Redis-based reservations
- **Payment Processing**: Stripe integration with webhook handling
- **Order Management**: Complete order lifecycle with status tracking
- **Image Processing**: Automated thumbnail generation and optimization
- **Search & Filtering**: Full-text search with MongoDB text indexes

### Performance & Scalability
- **Redis Caching**: Multi-layer caching for products, users, and sessions
- **Inventory Reservations**: Lua scripts for atomic stock operations
- **Background Jobs**: BullMQ for email, image processing, and analytics
- **Database Optimization**: Strategic indexing and query optimization
- **Horizontal Scaling**: Docker containers with load balancing

### Security & Compliance
- **JWT Authentication**: Access/refresh token pattern with blacklisting
- **Rate Limiting**: IP-based and user-based rate limiting
- **Input Validation**: Comprehensive validation with Joi schemas
- **Security Headers**: Helmet.js for security headers
- **PCI Compliance**: Tokenized payments, no PAN storage

### Monitoring & Observability
- **Metrics**: Prometheus integration with business metrics
- **Distributed Tracing**: OpenTelemetry with Jaeger
- **Structured Logging**: Winston with MongoDB integration
- **Health Checks**: Comprehensive health monitoring
- **Error Tracking**: Centralized error handling and logging

## 📋 Prerequisites

- Node.js 20+
- Docker & Docker Compose
- MongoDB 7.0+
- Redis 7.0+

## 🛠️ Quick Start

### Development Setup

1. **Clone and setup environment**:
   ```bash
   git clone https://github.com/MugishaProsper/aether-backend.git
   cd aether-backend
   cp .env.example .env
   # Edit .env with your configuration
   ```

2. **Run setup script**:
   ```bash
   chmod +x scripts/setup-dev.sh
   ./scripts/setup-dev.sh
   ```

3. **Start development services**:
   ```bash
   docker-compose up -d
   ```

4. **Install dependencies and start application**:
   ```bash
   npm install
   npm run dev
   ```

5. **Start background workers** (in separate terminal):
   ```bash
   npm run worker
   ```

### Production Deployment

1. **Build and deploy with Docker**:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

2. **Or deploy to Kubernetes**:
   ```bash
   kubectl apply -f k8s/
   ```

## 🌐 API Endpoints

### Authentication
```
POST   /api/auth/register          # User registration
POST   /api/auth/login             # User login
POST   /api/auth/logout            # User logout
POST   /api/auth/refresh           # Refresh access token
POST   /api/auth/forgot-password   # Password reset request
POST   /api/auth/reset-password    # Password reset
GET    /api/auth/me                # Get user profile
PUT    /api/auth/me                # Update user profile
```

### Products
```
GET    /api/products               # List products (with filters)
GET    /api/products/featured      # Get featured products
GET    /api/products/search        # Search products
GET    /api/products/:id           # Get single product
POST   /api/products               # Create product (Seller+)
PUT    /api/products/:id           # Update product (Seller+)
DELETE /api/products/:id           # Delete product (Seller+)
POST   /api/products/:id/images    # Upload product images
```

### Cart & Orders
```
GET    /api/cart                   # Get user cart
POST   /api/cart/items             # Add item to cart
PUT    /api/cart/items/:sku        # Update cart item
DELETE /api/cart/items/:sku        # Remove cart item
POST   /api/orders                 # Create order (checkout)
GET    /api/orders                 # List user orders
GET    /api/orders/:id             # Get order details
POST   /api/orders/:id/cancel      # Cancel order
```

### Payments
```
POST   /api/payments/intent        # Create payment intent
POST   /api/payments/confirm       # Confirm payment
POST   /api/webhooks/stripe        # Stripe webhooks
```

### Admin
```
GET    /api/admin/users            # List users (Admin+)
PUT    /api/admin/users/:id        # Update user (Admin+)
GET    /api/admin/orders           # List all orders (Admin+)
GET    /api/admin/analytics        # Get analytics data (Admin+)
GET    /api/admin/sales            # Sales reports (Seller+)
```

## 🏗️ Project Structure

```
src/
├── config/           # Configuration files
│   ├── database.js   # MongoDB configuration
│   ├── redis.js      # Redis configuration
│   ├── metrics.js    # Prometheus metrics
│   └── tracing.js    # OpenTelemetry tracing
├── controllers/      # Request handlers
├── middleware/       # Express middleware
│   ├── auth.js       # Authentication & authorization
│   ├── error.js      # Error handling
│   ├── logging.js    # Request logging
│   └── validation.js # Input validation
├── models/           # Mongoose models
│   ├── User.js       # User model
│   ├── Product.js    # Product model
│   ├── Order.js      # Order model
│   └── Cart.js       # Cart model
├── routes/           # Express routes
├── services/         # Business logic services
│   ├── CacheService.js      # Redis caching
│   └── InventoryService.js  # Inventory management
├── workers/          # Background job processors
│   ├── processors/   # Job processors
│   └── index.js      # Worker manager
└── utils/            # Utility functions
```

## 🔧 Configuration

### Environment Variables

Key configuration options in `.env`:

```env
# Database
MONGODB_URI=your_mongodb_url
REDIS_URI=redis://localhost:6379

# Authentication
JWT_ACCESS_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret

# Payment
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# AWS S3 (for file uploads)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=your-bucket

# Email
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@example.com
SMTP_PASS=your-app-password
```

### Role-Based Permissions

| Role | Permissions |
|------|-------------|
| **Visitor** | Browse products, guest checkout |
| **Buyer** | Full shopping experience, order history |
| **Seller** | Manage own products, view sales, process orders |
| **Admin** | Manage all merchants, system configuration |
| **Super Admin** | Full system access, user management |

## 📊 Monitoring & Analytics

### Metrics Dashboard
- **Business Metrics**: Orders, revenue, conversion rates
- **Technical Metrics**: Response times, error rates, cache hit ratios
- **Infrastructure**: CPU, memory, database performance

### Available Dashboards
- Application Performance (Grafana)
- Business Analytics (Custom)
- Infrastructure Monitoring (Prometheus)
- Error Tracking (Centralized logs)

## 🔒 Security Features

- **Authentication**: JWT with refresh tokens
- **Authorization**: Role-based access control
- **Rate Limiting**: Per-IP and per-user limits
- **Input Validation**: Joi schema validation
- **SQL Injection**: Mongoose ODM protection
- **XSS Protection**: Helmet.js security headers
- **CORS**: Configurable cross-origin policies
- **Session Management**: Redis-based sessions with TTL

## 🚀 Performance Optimizations

### Caching Strategy
- **L1 Cache**: Application-level caching
- **L2 Cache**: Redis for shared data
- **CDN**: Static asset delivery
- **Database**: Query optimization and indexing

### Inventory Management
- **Real-time Reservations**: Lua scripts for atomic operations
- **Stock Synchronization**: Background reconciliation jobs
- **Conflict Resolution**: Optimistic locking patterns

## 📈 Scaling Considerations

### Horizontal Scaling
- **Stateless Services**: All state in Redis/MongoDB
- **Load Balancing**: Nginx with health checks
- **Database Scaling**: MongoDB replica sets
- **Cache Scaling**: Redis cluster mode

### Performance Targets
- **API Response**: p95 < 200ms
- **Cart Operations**: p95 < 50ms
- **Checkout Flow**: End-to-end < 1s
- **Availability**: 99.95% uptime

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run integration tests
npm run test:integration

# Run load tests
npm run test:load
```

## 🚢 Deployment

### Docker Deployment
```bash
# Development
docker-compose up -d

# Production
docker-compose -f docker-compose.prod.yml up -d
```

### CI/CD Pipeline
- **GitHub Actions**: Automated testing and deployment
- **Security Scanning**: Dependency and container scanning
- **Multi-stage Builds**: Optimized Docker images
- **Blue-Green Deployment**: Zero-downtime deployments

## 📝 API Documentation

Aether API documentation available at:
- Development: `http://localhost:3000/api-docs`
- Production: `https://your-domain.com/api-docs`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check the `/docs` directory
- **Issues**: GitHub Issues for bug reports
- **Discussions**: GitHub Discussions for questions
- **Email**: nelsonprox92@gmail.com

## 🎯 Roadmap

- [ ] GraphQL API implementation
- [ ] Real-time notifications with WebSockets
- [ ] AI-powered product recommendations
- [ ] Advanced analytics and reporting
- [ ] Multi-currency support
- [ ] Inventory forecasting
- [ ] Advanced search with Elasticsearch

---

Built by Mugisha Prosper.