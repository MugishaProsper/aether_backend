import mongoose from 'mongoose';

const idempotencySchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    sparse: true, // Allow null for guest requests
  },
  sessionId: {
    type: String,
    index: true,
    sparse: true, // For guest requests
  },
  requestHash: {
    type: String,
    required: true, // Hash of request body for additional validation
  },
  response: {
    statusCode: {
      type: Number,
      required: true,
    },
    body: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    headers: {
      type: Map,
      of: String,
    },
  },
  endpoint: {
    type: String,
    required: true,
  },
  method: {
    type: String,
    required: true,
    enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    index: { expireAfterSeconds: 0 }, // TTL index
  },
}, {
  timestamps: true,
});

// Compound unique index
idempotencySchema.index(
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

// Additional indexes
idempotencySchema.index({ endpoint: 1, method: 1 });
idempotencySchema.index({ createdAt: -1 });

// Static methods
idempotencySchema.statics.findByKey = function(key, userId = null, sessionId = null) {
  const query = { key };
  
  if (userId) {
    query.userId = userId;
  } else if (sessionId) {
    query.sessionId = sessionId;
  }
  
  return this.findOne(query);
};

idempotencySchema.statics.createRecord = async function(data) {
  const record = new this({
    key: data.key,
    userId: data.userId,
    sessionId: data.sessionId,
    requestHash: data.requestHash,
    response: data.response,
    endpoint: data.endpoint,
    method: data.method,
  });
  
  return record.save();
};

idempotencySchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
};

const Idempotency = mongoose.model('Idempotency', idempotencySchema);

export default Idempotency;