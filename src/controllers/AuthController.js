import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../models/index.js';
import { config } from '../config/index.js';
import { redis } from '../config/redis.js';
import CacheService from '../services/CacheService.js';
import { EmailService } from '../workers/processors/email.js';
import {
  AuthenticationError,
  ValidationError,
  NotFoundError,
  successResponse
} from '../middleware/error.js';
import { logSecurity, setupLogging } from '../config/logging.js';

const logger = setupLogging();

class AuthController {
  register = async (req, res) => {
    const { email, password, fullname, phone, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      throw new ValidationError('User with this email already exists');
    }

    // Create new user
    const user = new User({
      email,
      passwordHash: password, // Will be hashed by pre-save hook
      profile: {
        name: fullname,
        phone: phone
      },
      role: role || 'BUYER',
      verification: {
        email: {
          verified: false,
          token: uuidv4(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      },
    });

    // Generate merchant ID for sellers
    if (role === 'SELLER') {
      user.merchantId = `merchant_${uuidv4().replace(/-/g, '').substring(0, 16)}`;
    }

    await user.save();

    // Send verification email
    await EmailService.sendVerificationEmail(
      email,
      fullname,
      `${process.env.FRONTEND_URL}/verify-email?token=${user.verification.email.token}`
    );

    // Generate tokens
    const { accessToken, refreshToken } = await this.generateTokens(user);

    // Set refresh token cookie
    this.setRefreshTokenCookie(res, refreshToken);

    logger.info('User registered successfully', {
      userId: user._id,
      email,
      role: user.role
    });

    return successResponse(res, {
      user: user.toJSON(),
      accessToken: accessToken,
      refreshToken: refreshToken,
    }, 'Registration successful', 201);
  }

  login = async (req, res) => {
    const { email, password, rememberMe } = req.body;
    const clientIP = req.ip;
    const userAgent = req.get('User-Agent');

    // Find user
    const user = await User.findByEmail(email);
    if (!user) {
      logSecurity('LOGIN_ATTEMPT_INVALID_EMAIL', req, { email });
      throw new AuthenticationError('Invalid email or password');
    }

    // Check if account is locked
    if (user.isLocked) {
      logSecurity('LOGIN_ATTEMPT_LOCKED_ACCOUNT', req, { userId: user._id });
      throw new AuthenticationError('Account is temporarily locked due to too many failed login attempts');
    }

    // Verify password
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      await user.incrementLoginAttempts();
      logSecurity('LOGIN_ATTEMPT_INVALID_PASSWORD', req, { userId: user._id });
      throw new AuthenticationError('Invalid email or password');
    }

    // Reset login attempts on successful login
    if (user.security.loginAttempts > 0) {
      await user.resetLoginAttempts();
    }

    // Update last login
    user.lastLoginAt = new Date();
    user.lastLoginIP = clientIP;
    user.lastLoginAgent = userAgent
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = await this.generateTokens(user, req, rememberMe);
    console.log(accessToken, refreshToken)

    // Set refresh token cookie
    this.setRefreshTokenCookie(res, refreshToken, rememberMe);

    // Cache user data
    await CacheService.setUser(user._id.toString(), user.toJSON());

    logger.info('User logged in successfully', {
      userId: user._id,
      email,
      ip: clientIP
    });

    return successResponse(res, {
      user: user.toJSON(),
      accessToken: accessToken,
      refreshToken: refreshToken,
    }, 'Login successful');
  }

  logout = async (req, res) => {
    const { user, tokenPayload } = req;
    const refreshToken = req.cookies.refreshToken;

    // Blacklist access token
    if (tokenPayload) {
      const tokenTTL = tokenPayload.exp - Math.floor(Date.now() / 1000);
      if (tokenTTL > 0) {
        await redis.set(`blacklist:${req.headers.authorization?.split(' ')[1]}`, '1', tokenTTL);
      }
    }

    // Remove refresh token
    if (refreshToken) {
      await redis.del(`refresh:${refreshToken}`);
    }

    // Remove session
    if (tokenPayload?.sessionId) {
      await redis.deleteSession(tokenPayload.sessionId);
    }

    // Clear cache
    await CacheService.delUser(user._id.toString());

    // Clear cookie
    res.clearCookie('refreshToken');

    logger.info('User logged out successfully', { userId: user._id });

    return successResponse(res, null, 'Logout successful');
  }

  logoutAll = async (req, res) => {
    const { user } = req;

    // Remove all refresh tokens for user
    const pattern = `refresh:*:${user._id}`;
    await redis.delPattern(pattern);

    // Remove all sessions for user
    const sessionPattern = `session:*:${user._id}`;
    await redis.delPattern(sessionPattern);

    // Clear cache
    await CacheService.delUser(user._id.toString());

    // Clear cookie
    res.clearCookie('refreshToken');

    logger.info('User logged out from all devices', { userId: user._id });

    return successResponse(res, null, 'Logged out from all devices');
  }

  refreshToken = async (req, res) => {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      throw new AuthenticationError('Refresh token not provided');
    }

    // Get refresh token data
    const tokenData = await redis.getJson(`refresh:${refreshToken}`);
    if (!tokenData) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    // Get user
    const user = await User.findById(tokenData.userId);
    if (!user || user.status !== 'active') {
      throw new AuthenticationError('User not found or inactive');
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = await this.generateTokens(user);

    // Remove old refresh token
    await redis.del(`refresh:${refreshToken}`);

    // Set new refresh token cookie
    this.setRefreshTokenCookie(res, newRefreshToken);

    return successResponse(res, {
      accessToken,
      user: user.toJSON(),
    }, 'Token refreshed successfully');
  }

  forgotPassword = async (req, res) => {
    const { email } = req.body;

    const user = await User.findByEmail(email);
    if (!user) {
      // Don't reveal if email exists
      return successResponse(res, null, 'If the email exists, a reset link has been sent');
    }

    // Generate reset token
    const resetToken = user.createPasswordResetToken();
    await user.save();

    // Send reset email
    await EmailService.sendPasswordReset(
      email,
      user.profile.name,
      `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`
    );

    logger.info('Password reset requested', { userId: user._id, email });

    return successResponse(res, null, 'If the email exists, a reset link has been sent');
  }

  resetPassword = async (req, res) => {
    const { token, password } = req.body;

    const user = await User.findOne({
      'security.passwordResetToken': token,
      'security.passwordResetExpires': { $gt: Date.now() },
    });

    if (!user) {
      throw new ValidationError('Invalid or expired reset token');
    }

    // Update password
    user.passwordHash = password; // Will be hashed by pre-save hook
    user.security.passwordResetToken = undefined;
    user.security.passwordResetExpires = undefined;

    // Reset login attempts
    await user.resetLoginAttempts();

    await user.save();

    // Logout from all devices
    const pattern = `refresh:*:${user._id}`;
    await redis.delPattern(pattern);

    logger.info('Password reset successfully', { userId: user._id });

    return successResponse(res, null, 'Password reset successful');
  }

  verifyEmail = async (req, res) => {
    const { token } = req.body;

    const user = await User.findOne({
      'verification.email.token': token,
      'verification.email.expiresAt': { $gt: Date.now() },
    });

    if (!user) {
      throw new ValidationError('Invalid or expired verification token');
    }

    user.verification.email.verified = true;
    user.verification.email.token = undefined;
    user.verification.email.expiresAt = undefined;
    await user.save();

    logger.info('Email verified successfully', { userId: user._id });

    return successResponse(res, null, 'Email verified successfully');
  }

  resendVerification = async (req, res) => {
    const { user } = req;

    if (user.verification.email.verified) {
      throw new ValidationError('Email is already verified');
    }

    // Generate new verification token
    user.verification.email.token = uuidv4();
    user.verification.email.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    // Send verification email
    await EmailService.sendVerificationEmail(
      user.email,
      user.profile.name,
      `${process.env.FRONTEND_URL}/verify-email?token=${user.verification.email.token}`
    );

    return successResponse(res, null, 'Verification email sent');
  }

  getProfile = async (req, res) => {
    const { user } = req;
    return successResponse(res, user.toJSON(), 'Profile retrieved successfully');
  }

  updateProfile = async (req, res) => {
    const { user } = req;
    const updates = req.body;

    // Update allowed fields
    const allowedUpdates = ['name', 'phone', 'address'];
    const profileUpdates = {};

    for (const field of allowedUpdates) {
      if (updates[field] !== undefined) {
        profileUpdates[`profile.${field}`] = updates[field];
      }
    }

    await User.findByIdAndUpdate(user._id, { $set: profileUpdates }, { new: true });
    const updatedUser = await User.findById(user._id);

    // Update cache
    await CacheService.setUser(user._id.toString(), updatedUser.toJSON());

    logger.info('Profile updated successfully', { userId: user._id });

    return successResponse(res, updatedUser.toJSON(), 'Profile updated successfully');
  }

  changePassword = async (req, res) => {
    const { user } = req;
    const { currentPassword, newPassword } = req.body;

    // Verify current password
    const isValid = await user.comparePassword(currentPassword);
    if (!isValid) {
      throw new ValidationError('Current password is incorrect');
    }

    // Update password
    user.passwordHash = newPassword; // Will be hashed by pre-save hook
    await user.save();

    // Logout from all other devices
    const pattern = `refresh:*:${user._id}`;
    await redis.delPattern(pattern);

    logger.info('Password changed successfully', { userId: user._id });

    return successResponse(res, null, 'Password changed successfully');
  }

  getSessions = async (req, res) => {
    const { user } = req;

    // Get all active refresh tokens
    const pattern = `refresh:*:${user._id}`;
    const keys = await redis.getClient().keys(pattern);

    const sessions = [];
    for (const key of keys) {
      const sessionData = await redis.getJson(key);
      if (sessionData) {
        sessions.push({
          sessionId: sessionData.sessionId,
          createdAt: sessionData.createdAt,
          lastActivity: sessionData.lastActivity,
          userAgent: sessionData.userAgent,
          ip: sessionData.ip,
          current: sessionData.sessionId === req.tokenPayload?.sessionId,
        });
      }
    }

    return successResponse(res, sessions, 'Sessions retrieved successfully');
  }

  revokeSession = async (req, res) => {
    const { user } = req;
    const { sessionId } = req.params;

    // Find and remove the specific session
    const pattern = `refresh:*:${user._id}`;
    const keys = await redis.getClient().keys(pattern);

    for (const key of keys) {
      const sessionData = await redis.getJson(key);
      if (sessionData && sessionData.sessionId === sessionId) {
        await redis.del(key);
        await redis.deleteSession(sessionId);
        break;
      }
    }

    return successResponse(res, null, 'Session revoked successfully');
  }

  // Helper methods
  async generateTokens(user, req, rememberMe = false) {
    const sessionId = uuidv4();
    const jti = uuidv4(); // JWT ID for token revocation

    // Access token payload
    const accessPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      sessionId,
      jti,
    };

    // Generate access token
    const accessToken = jwt.sign(
      accessPayload,
      config.jwt.accessTokenSecret,
      {
        expiresIn: config.jwt.accessTokenExpiry,
        issuer: 'aether-backend',
        audience: 'aether-frontend',
      }
    );

    // Generate refresh token
    const refreshToken = uuidv4();
    const refreshTokenTTL = rememberMe ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60; // 30 days or 7 days

    // Store refresh token data
    const refreshTokenData = {
      userId: user._id.toString(),
      sessionId,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    };

    await redis.setJson(`refresh:${refreshToken}:${user._id}`, refreshTokenData, refreshTokenTTL);

    // Store session data
    await CacheService.setSession(sessionId, {
      userId: user._id.toString(),
      ...refreshTokenData,
    });

    return { accessToken, refreshToken };
  }

  setRefreshTokenCookie(res, refreshToken, rememberMe = false) {
    const maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'lax',
      maxAge,
      path: '/api/auth',
    });
  }
}

export default new AuthController();