import nodemailer from 'nodemailer';
import { config } from '../../config/index.js';
import { setupLogging } from '../../config/logging.js';

const logger = setupLogging();

// Email templates
const templates = {
  welcome: {
    subject: 'Welcome to Our E-commerce Platform',
    html: (data) => `
      <h1>Welcome, ${data.name}!</h1>
      <p>Thank you for joining our platform. We're excited to have you on board.</p>
      <p>Start exploring our products and enjoy your shopping experience.</p>
    `,
  },
  
  orderConfirmation: {
    subject: 'Order Confirmation - #{orderNumber}',
    html: (data) => `
      <h1>Order Confirmation</h1>
      <p>Hi ${data.customerName},</p>
      <p>Thank you for your order! Here are the details:</p>
      <div style="border: 1px solid #ddd; padding: 20px; margin: 20px 0;">
        <h3>Order #${data.orderNumber}</h3>
        <p><strong>Total:</strong> ${data.total} ${data.currency}</p>
        <p><strong>Status:</strong> ${data.status}</p>
        <h4>Items:</h4>
        <ul>
          ${data.items.map(item => `
            <li>${item.title} x ${item.quantity} - ${item.totalPrice} ${data.currency}</li>
          `).join('')}
        </ul>
      </div>
      <p>We'll send you another email when your order ships.</p>
    `,
  },
  
  orderShipped: {
    subject: 'Your Order Has Shipped - #{orderNumber}',
    html: (data) => `
      <h1>Order Shipped</h1>
      <p>Hi ${data.customerName},</p>
      <p>Great news! Your order #${data.orderNumber} has been shipped.</p>
      ${data.trackingNumber ? `
        <p><strong>Tracking Number:</strong> ${data.trackingNumber}</p>
        <p><strong>Carrier:</strong> ${data.carrier}</p>
      ` : ''}
      <p><strong>Estimated Delivery:</strong> ${data.estimatedDelivery}</p>
    `,
  },
  
  passwordReset: {
    subject: 'Password Reset Request',
    html: (data) => `
      <h1>Password Reset</h1>
      <p>Hi ${data.name},</p>
      <p>You requested to reset your password. Click the link below to reset it:</p>
      <a href="${data.resetLink}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a>
      <p>This link will expire in 10 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `,
  },
  
  paymentFailed: {
    subject: 'Payment Failed - Order #{orderNumber}',
    html: (data) => `
      <h1>Payment Failed</h1>
      <p>Hi ${data.customerName},</p>
      <p>We were unable to process the payment for your order #${data.orderNumber}.</p>
      <p><strong>Reason:</strong> ${data.failureReason}</p>
      <p>Please try again or use a different payment method.</p>
      <a href="${data.retryLink}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Retry Payment</a>
    `,
  },
  
  lowStock: {
    subject: 'Low Stock Alert - {productTitle}',
    html: (data) => `
      <h1>Low Stock Alert</h1>
      <p>Hi ${data.merchantName},</p>
      <p>The following product is running low on stock:</p>
      <div style="border: 1px solid #ddd; padding: 20px; margin: 20px 0;">
        <h3>${data.productTitle}</h3>
        <p><strong>SKU:</strong> ${data.sku}</p>
        <p><strong>Current Stock:</strong> ${data.currentStock}</p>
        <p><strong>Threshold:</strong> ${data.threshold}</p>
      </div>
      <p>Please restock this item to avoid running out.</p>
    `,
  },
};

// Create transporter
let transporter = null;

const createTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransporter({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.secure,
      auth: config.email.smtp.auth,
    });
  }
  return transporter;
};

export const processEmailJob = async (job) => {
  const { type, data } = job.data;
  
  try {
    logger.info(`Processing email job: ${type}`, { jobId: job.id });
    
    const template = templates[type];
    if (!template) {
      throw new Error(`Unknown email template: ${type}`);
    }

    const transporter = createTransporter();
    
    // Prepare email content
    const subject = template.subject.replace(/\{(\w+)\}/g, (match, key) => data[key] || match);
    const html = template.html(data);
    
    const mailOptions = {
      from: config.email.from,
      to: data.email,
      subject,
      html,
    };

    // Add CC/BCC if specified
    if (data.cc) mailOptions.cc = data.cc;
    if (data.bcc) mailOptions.bcc = data.bcc;

    // Send email
    const result = await transporter.sendMail(mailOptions);
    
    logger.info(`Email sent successfully: ${type}`, {
      jobId: job.id,
      messageId: result.messageId,
      to: data.email,
    });

    return {
      success: true,
      messageId: result.messageId,
      type,
      recipient: data.email,
    };
    
  } catch (error) {
    logger.error(`Email job failed: ${type}`, {
      jobId: job.id,
      error: error.message,
      data,
    });
    
    // Re-throw error to mark job as failed
    throw error;
  }
};

// Email utility functions for easy use
export const EmailService = {
  async sendVerificationEmail(email, fullname, verification_url){
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addEmailJob('verification', { email, fullname, verification_url });
  },
  
  async sendWelcomeEmail(email, name) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addEmailJob('welcome', { email, name });
  },

  async sendOrderConfirmation(order, customer) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addEmailJob('orderConfirmation', {
      email: customer.email,
      customerName: customer.name,
      orderNumber: order.orderNumber,
      total: order.pricing.total,
      currency: order.currency,
      status: order.status,
      items: order.items,
    });
  },

  async sendOrderShipped(order, customer, shipping) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addEmailJob('orderShipped', {
      email: customer.email,
      customerName: customer.name,
      orderNumber: order.orderNumber,
      trackingNumber: shipping.trackingNumber,
      carrier: shipping.carrier,
      estimatedDelivery: shipping.estimatedDelivery,
    });
  },

  async sendPasswordReset(email, name, resetLink) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addEmailJob('passwordReset', {
      email,
      name,
      resetLink,
    }, { priority: 1 }); // High priority
  },

  async sendPaymentFailed(order, customer, failureReason, retryLink) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addEmailJob('paymentFailed', {
      email: customer.email,
      customerName: customer.name,
      orderNumber: order.orderNumber,
      failureReason,
      retryLink,
    }, { priority: 1 }); // High priority
  },

  async sendLowStockAlert(merchant, product, sku, currentStock, threshold = 10) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addEmailJob('lowStock', {
      email: merchant.email,
      merchantName: merchant.name,
      productTitle: product.title,
      sku,
      currentStock,
      threshold,
    });
  },

  // Bulk email sending
  async sendBulkEmails(emailJobs) {
    const { JobScheduler } = await import('../index.js');
    const jobs = emailJobs.map(job => ({
      name: job.type,
      data: job,
    }));
    
    return JobScheduler.addBulkJobs('email', jobs);
  },

  // Newsletter/marketing emails
  async sendNewsletter(recipients, subject, content) {
    const { JobScheduler } = await import('../index.js');
    const jobs = recipients.map(recipient => ({
      name: 'newsletter',
      data: {
        email: recipient.email,
        name: recipient.name,
        subject,
        content,
      },
    }));
    
    return JobScheduler.addBulkJobs('email', jobs);
  },
};