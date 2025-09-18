import sharp from 'sharp';
import AWS from 'aws-sdk';
import fs from 'fs';
import path from 'path';
import { config } from '../../config/index.js';
import { setupLogging } from '../../config/logging.js';

const logger = setupLogging();

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: config.aws.accessKeyId,
  secretAccessKey: config.aws.secretAccessKey,
  region: config.aws.region,
});

// Image processing configurations
const imageConfigs = {
  thumbnail: { width: 150, height: 150, quality: 80 },
  small: { width: 300, height: 300, quality: 85 },
  medium: { width: 600, height: 600, quality: 90 },
  large: { width: 1200, height: 1200, quality: 95 },
  hero: { width: 1920, height: 1080, quality: 90 },
};

export const processImageJob = async (job) => {
  const { type, data } = job.data;
  
  try {
    logger.info(`Processing image job: ${type}`, { jobId: job.id });
    
    switch (type) {
      case 'processProductImage':
        return await processProductImage(data);
      case 'generateThumbnails':
        return await generateThumbnails(data);
      case 'optimizeImage':
        return await optimizeImage(data);
      case 'resizeImage':
        return await resizeImage(data);
      case 'watermarkImage':
        return await watermarkImage(data);
      default:
        throw new Error(`Unknown image processing type: ${type}`);
    }
    
  } catch (error) {
    logger.error(`Image job failed: ${type}`, {
      jobId: job.id,
      error: error.message,
      data,
    });
    
    throw error;
  }
};

async function processProductImage(data) {
  const { imagePath, productId, merchantId, isMain = false } = data;
  
  try {
    // Read the original image
    const imageBuffer = fs.readFileSync(imagePath);
    
    // Generate multiple sizes
    const variants = {};
    const uploadPromises = [];
    
    for (const [sizeName, config] of Object.entries(imageConfigs)) {
      const processedBuffer = await sharp(imageBuffer)
        .resize(config.width, config.height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: config.quality })
        .toBuffer();
      
      // Generate S3 key
      const s3Key = `products/${merchantId}/${productId}/${sizeName}/${Date.now()}.jpg`;
      
      // Upload to S3
      const uploadPromise = s3.upload({
        Bucket: config.aws.s3.bucket,
        Key: s3Key,
        Body: processedBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'max-age=31536000', // 1 year
      }).promise().then(result => ({
        size: sizeName,
        url: result.Location,
        key: s3Key,
        width: config.width,
        height: config.height,
      }));
      
      uploadPromises.push(uploadPromise);
    }
    
    // Wait for all uploads to complete
    const uploadResults = await Promise.all(uploadPromises);
    
    // Organize results by size
    uploadResults.forEach(result => {
      variants[result.size] = {
        url: result.url,
        key: result.key,
        width: result.width,
        height: result.height,
      };
    });
    
    // Clean up original file
    fs.unlinkSync(imagePath);
    
    // Update product in database
    const { Product } = await import('../../models/index.js');
    const product = await Product.findById(productId);
    
    if (product) {
      const imageData = {
        url: variants.large.url,
        alt: `${product.title} - Product Image`,
        isPrimary: isMain,
        variants,
      };
      
      product.images.push(imageData);
      await product.save();
      
      logger.info(`Product image processed and saved`, {
        productId,
        variants: Object.keys(variants),
      });
    }
    
    return {
      success: true,
      productId,
      variants,
      uploadCount: uploadResults.length,
    };
    
  } catch (error) {
    logger.error('Error processing product image:', error);
    
    // Clean up file on error
    try {
      fs.unlinkSync(imagePath);
    } catch (cleanupError) {
      logger.error('Error cleaning up file:', cleanupError);
    }
    
    throw error;
  }
}

async function generateThumbnails(data) {
  const { imageUrl, sizes = ['thumbnail', 'small', 'medium'] } = data;
  
  try {
    // Download image from URL
    const response = await fetch(imageUrl);
    const imageBuffer = await response.arrayBuffer();
    
    const thumbnails = {};
    const uploadPromises = [];
    
    for (const sizeName of sizes) {
      const config = imageConfigs[sizeName];
      if (!config) continue;
      
      const processedBuffer = await sharp(Buffer.from(imageBuffer))
        .resize(config.width, config.height, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: config.quality })
        .toBuffer();
      
      const s3Key = `thumbnails/${sizeName}/${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`;
      
      const uploadPromise = s3.upload({
        Bucket: config.aws.s3.bucket,
        Key: s3Key,
        Body: processedBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'max-age=31536000',
      }).promise().then(result => ({
        size: sizeName,
        url: result.Location,
        key: s3Key,
      }));
      
      uploadPromises.push(uploadPromise);
    }
    
    const uploadResults = await Promise.all(uploadPromises);
    
    uploadResults.forEach(result => {
      thumbnails[result.size] = {
        url: result.url,
        key: result.key,
      };
    });
    
    return {
      success: true,
      originalUrl: imageUrl,
      thumbnails,
    };
    
  } catch (error) {
    logger.error('Error generating thumbnails:', error);
    throw error;
  }
}

async function optimizeImage(data) {
  const { imagePath, quality = 85, format = 'jpeg' } = data;
  
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    
    let sharpInstance = sharp(imageBuffer);
    
    // Apply format-specific optimizations
    switch (format.toLowerCase()) {
      case 'jpeg':
      case 'jpg':
        sharpInstance = sharpInstance.jpeg({
          quality,
          progressive: true,
          mozjpeg: true,
        });
        break;
      case 'png':
        sharpInstance = sharpInstance.png({
          quality,
          compressionLevel: 9,
          palette: true,
        });
        break;
      case 'webp':
        sharpInstance = sharpInstance.webp({
          quality,
          effort: 6,
        });
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
    
    const optimizedBuffer = await sharpInstance.toBuffer();
    
    // Calculate compression ratio
    const originalSize = imageBuffer.length;
    const optimizedSize = optimizedBuffer.length;
    const compressionRatio = ((originalSize - optimizedSize) / originalSize * 100).toFixed(2);
    
    // Save optimized image
    const optimizedPath = imagePath.replace(/\.[^/.]+$/, `_optimized.${format}`);
    fs.writeFileSync(optimizedPath, optimizedBuffer);
    
    logger.info('Image optimized', {
      originalSize,
      optimizedSize,
      compressionRatio: `${compressionRatio}%`,
      format,
    });
    
    return {
      success: true,
      originalPath: imagePath,
      optimizedPath,
      originalSize,
      optimizedSize,
      compressionRatio: parseFloat(compressionRatio),
      format,
    };
    
  } catch (error) {
    logger.error('Error optimizing image:', error);
    throw error;
  }
}

async function resizeImage(data) {
  const { imagePath, width, height, fit = 'inside', quality = 90 } = data;
  
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    
    const resizedBuffer = await sharp(imageBuffer)
      .resize(width, height, {
        fit,
        withoutEnlargement: true,
      })
      .jpeg({ quality })
      .toBuffer();
    
    const resizedPath = imagePath.replace(/\.[^/.]+$/, `_${width}x${height}.jpg`);
    fs.writeFileSync(resizedPath, resizedBuffer);
    
    return {
      success: true,
      originalPath: imagePath,
      resizedPath,
      width,
      height,
      size: resizedBuffer.length,
    };
    
  } catch (error) {
    logger.error('Error resizing image:', error);
    throw error;
  }
}

async function watermarkImage(data) {
  const { imagePath, watermarkPath, position = 'southeast', opacity = 0.7 } = data;
  
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    const watermarkBuffer = fs.readFileSync(watermarkPath);
    
    // Prepare watermark
    const watermark = await sharp(watermarkBuffer)
      .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    
    const watermarkedBuffer = await sharp(imageBuffer)
      .composite([{
        input: watermark,
        gravity: position,
        blend: 'over',
      }])
      .jpeg({ quality: 90 })
      .toBuffer();
    
    const watermarkedPath = imagePath.replace(/\.[^/.]+$/, '_watermarked.jpg');
    fs.writeFileSync(watermarkedPath, watermarkedBuffer);
    
    return {
      success: true,
      originalPath: imagePath,
      watermarkedPath,
      position,
      opacity,
    };
    
  } catch (error) {
    logger.error('Error adding watermark:', error);
    throw error;
  }
}

// Image service utility functions
export const ImageService = {
  async processProductImage(imagePath, productId, merchantId, isMain = false) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addImageJob('processProductImage', {
      imagePath,
      productId,
      merchantId,
      isMain,
    });
  },

  async generateThumbnails(imageUrl, sizes) {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addImageJob('generateThumbnails', {
      imageUrl,
      sizes,
    });
  },

  async optimizeImage(imagePath, quality = 85, format = 'jpeg') {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addImageJob('optimizeImage', {
      imagePath,
      quality,
      format,
    });
  },

  async resizeImage(imagePath, width, height, fit = 'inside') {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addImageJob('resizeImage', {
      imagePath,
      width,
      height,
      fit,
    });
  },

  async watermarkImage(imagePath, watermarkPath, position = 'southeast') {
    const { JobScheduler } = await import('../index.js');
    return JobScheduler.addImageJob('watermarkImage', {
      imagePath,
      watermarkPath,
      position,
    });
  },

  // Batch processing
  async processBatchImages(imageJobs) {
    const { JobScheduler } = await import('../index.js');
    const jobs = imageJobs.map(job => ({
      name: job.type,
      data: job,
    }));
    
    return JobScheduler.addBulkJobs('image', jobs);
  },
};