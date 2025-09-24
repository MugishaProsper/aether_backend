import { Worker, Queue } from 'bullmq';
import { redis } from '../config/redis.js';
import { config } from '../config/index.js';
import { setupLogging } from '../config/logging.js';

// Import job processors
import { processEmailJob } from './processors/email.js';
import { processImageJob } from './processors/image.js';
import { processOrderJob } from './processors/order.js';
import { processAnalyticsJob } from './processors/analytics.js';
import { processPaymentJob } from './processors/payment.js';
import { processInventoryJob } from './processors/inventory.js';
import { processNotificationJob } from './processors/notification.js';

const logger = setupLogging();

// Queue definitions
export const QUEUES = {
  EMAIL: 'email',
  IMAGE: 'image',
  ORDER: 'order',
  ANALYTICS: 'analytics',
  PAYMENT: 'payment',
  INVENTORY: 'inventory',
  NOTIFICATION: 'notification'
};

// Job priorities
export const PRIORITY = {
  CRITICAL: 1,
  HIGH: 5,
  NORMAL: 10,
  LOW: 15,
};

class WorkerManager {
  constructor() {
    this.workers = new Map();
    this.queues = new Map();
    this.isShuttingDown = false;
  }

  async initialize() {
    try {
      // Create queues
      await this.createQueues();
      
      // Start workers
      await this.startWorkers();
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
      logger.info('Worker manager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize worker manager:', error);
      throw error;
    }
  }

  async createQueues() {
    const redisConnection = {
      host: redis.getClient().options.host,
      port: redis.getClient().options.port,
      password: redis.getClient().options.password,
      db: redis.getClient().options.db || 0,
    };

    for (const [name, queueName] of Object.entries(QUEUES)) {
      const queue = new Queue(queueName, {
        connection: redisConnection,
        defaultJobOptions: {
          removeOnComplete: 100, // Keep last 100 completed jobs
          removeOnFail: 50,      // Keep last 50 failed jobs
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      });

      this.queues.set(queueName, queue);
      logger.info(`Queue created: ${queueName}`);
    }
  }

  async startWorkers() {
    const redisConnection = {
      host: redis.getClient().options.host,
      port: redis.getClient().options.port,
      password: redis.getClient().options.password,
      db: redis.getClient().options.db || 0,
    };

    const workerConfigs = [
      {
        name: QUEUES.EMAIL,
        processor: processEmailJob,
        concurrency: 5,
      },
      {
        name: QUEUES.IMAGE,
        processor: processImageJob,
        concurrency: 3,
      },
      {
        name: QUEUES.ORDER,
        processor: processOrderJob,
        concurrency: 10,
      },
      {
        name: QUEUES.ANALYTICS,
        processor: processAnalyticsJob,
        concurrency: 2,
      },
      {
        name: QUEUES.PAYMENT,
        processor: processPaymentJob,
        concurrency: 5,
      },
      {
        name: QUEUES.INVENTORY,
        processor: processInventoryJob,
        concurrency: 3,
      },
      {
        name: QUEUES.NOTIFICATION,
        processor: processNotificationJob,
        concurrency: 8,
      },
    ];

    for (const { name, processor, concurrency } of workerConfigs) {
      const worker = new Worker(name, processor, {
        connection: redisConnection,
        concurrency,
        limiter: {
          max: 100,
          duration: 60000, // 100 jobs per minute
        },
      });

      // Event handlers
      worker.on('completed', (job) => {
        logger.info(`Job completed: ${job.name} (${job.id})`, {
          queue: name,
          jobId: job.id,
          duration: job.finishedOn - job.processedOn,
        });
      });

      worker.on('failed', (job, error) => {
        logger.error(`Job failed: ${job.name} (${job.id})`, {
          queue: name,
          jobId: job.id,
          error: error.message,
          attempts: job.attemptsMade,
        });
      });

      worker.on('error', (error) => {
        logger.error(`Worker error in ${name}:`, error);
      });

      worker.on('stalled', (jobId) => {
        logger.warn(`Job stalled: ${jobId} in queue ${name}`);
      });

      this.workers.set(name, worker);
      logger.info(`Worker started: ${name} (concurrency: ${concurrency})`);
    }
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      logger.info(`Received ${signal}, starting graceful worker shutdown...`);

      try {
        // Close all workers
        const workerPromises = Array.from(this.workers.values()).map(worker => 
          worker.close()
        );

        // Close all queues
        const queuePromises = Array.from(this.queues.values()).map(queue => 
          queue.close()
        );

        await Promise.all([...workerPromises, ...queuePromises]);
        
        logger.info('All workers and queues closed successfully');
        process.exit(0);
      } catch (error) {
        logger.error('Error during worker shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  getQueue(queueName) {
    return this.queues.get(queueName);
  }

  getWorker(workerName) {
    return this.workers.get(workerName);
  }

  async getQueueStats() {
    const stats = {};

    for (const [name, queue] of this.queues) {
      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaiting(),
          queue.getActive(),
          queue.getCompleted(),
          queue.getFailed(),
          queue.getDelayed(),
        ]);

        stats[name] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
        };
      } catch (error) {
        logger.error(`Error getting stats for queue ${name}:`, error);
        stats[name] = { error: error.message };
      }
    }

    return stats;
  }

  async pauseQueue(queueName) {
    const queue = this.getQueue(queueName);
    if (queue) {
      await queue.pause();
      logger.info(`Queue paused: ${queueName}`);
    }
  }

  async resumeQueue(queueName) {
    const queue = this.getQueue(queueName);
    if (queue) {
      await queue.resume();
      logger.info(`Queue resumed: ${queueName}`);
    }
  }

  async cleanQueue(queueName, grace = 3600000) { // 1 hour default
    const queue = this.getQueue(queueName);
    if (queue) {
      await queue.clean(grace, 100, 'completed');
      await queue.clean(grace, 100, 'failed');
      logger.info(`Queue cleaned: ${queueName}`);
    }
  }
}

// Export singleton instance
export const workerManager = new WorkerManager();

// Job scheduling utilities
export class JobScheduler {
  static async addEmailJob(type, data, options = {}) {
    const queue = workerManager.getQueue(QUEUES.EMAIL);
    return queue.add(type, data, {
      priority: options.priority || PRIORITY.NORMAL,
      delay: options.delay || 0,
      ...options,
    });
  }

  static async addImageJob(type, data, options = {}) {
    const queue = workerManager.getQueue(QUEUES.IMAGE);
    return queue.add(type, data, {
      priority: options.priority || PRIORITY.NORMAL,
      ...options,
    });
  }

  static async addOrderJob(type, data, options = {}) {
    const queue = workerManager.getQueue(QUEUES.ORDER);
    return queue.add(type, data, {
      priority: options.priority || PRIORITY.HIGH,
      ...options,
    });
  }

  static async addAnalyticsJob(type, data, options = {}) {
    const queue = workerManager.getQueue(QUEUES.ANALYTICS);
    return queue.add(type, data, {
      priority: options.priority || PRIORITY.LOW,
      ...options,
    });
  }

  static async addPaymentJob(type, data, options = {}) {
    const queue = workerManager.getQueue(QUEUES.PAYMENT);
    return queue.add(type, data, {
      priority: options.priority || PRIORITY.CRITICAL,
      ...options,
    });
  }

  static async addInventoryJob(type, data, options = {}) {
    const queue = workerManager.getQueue(QUEUES.INVENTORY);
    return queue.add(type, data, {
      priority: options.priority || PRIORITY.HIGH,
      ...options,
    });
  }

  static async addNotificationJob(type, data, options = {}) {
    const queue = workerManager.getQueue(QUEUES.NOTIFICATION);
    return queue.add(type, data, {
      priority: options.priority || PRIORITY.NORMAL,
      ...options,
    });
  }

  // Recurring jobs
  static async addRecurringJob(queueName, jobName, data, cronExpression, options = {}) {
    const queue = workerManager.getQueue(queueName);
    return queue.add(jobName, data, {
      repeat: { cron: cronExpression },
      ...options,
    });
  }

  // Bulk jobs
  static async addBulkJobs(queueName, jobs) {
    const queue = workerManager.getQueue(queueName);
    return queue.addBulk(jobs);
  }
}

// Start worker manager if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  workerManager.initialize().catch(error => {
    logger.error('Failed to start worker manager:', error);
    process.exit(1);
  });
}

export default workerManager;