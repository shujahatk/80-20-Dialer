import jwt from 'jsonwebtoken';
import { UserStore } from '../store.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_change_in_production';
const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes sliding access window
const REFRESH_TOKEN_EXPIRY = '7d'; // 7 days long-lived refresh token
const ACCESS_TOKEN_SECONDS = 15 * 60; // 900 seconds

/**
 * Generates a short-lived access token (15m)
 */
import crypto from 'crypto';

export function generateAccessToken(user) {
  const userId = typeof user === 'object' && user ? (user._id || user.id) : user;
  const tokenVersion = typeof user === 'object' && user ? (user.tokenVersion || 1) : 1;
  const role = typeof user === 'object' && user ? user.role : undefined;
  const email = typeof user === 'object' && user ? user.email : undefined;

  return jwt.sign(
    {
      id: userId,
      role,
      email,
      tokenVersion,
      type: 'access',
      jti: crypto.randomBytes(8).toString('hex')
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

/**
 * Generates a long-lived refresh token (7d)
 */
export function generateRefreshToken(user) {
  const userId = typeof user === 'object' && user ? (user._id || user.id) : user;
  const tokenVersion = typeof user === 'object' && user ? (user.tokenVersion || 1) : 1;

  return jwt.sign(
    {
      id: userId,
      tokenVersion,
      type: 'refresh',
      jti: crypto.randomBytes(8).toString('hex')
    },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
}

/**
 * Generates both access token and refresh token pair
 */
export function generateAuthTokens(user) {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(user),
    expiresIn: ACCESS_TOKEN_SECONDS,
    tokenType: 'Bearer'
  };
}

export const generateTokens = generateAuthTokens;

/**
 * Verifies any JWT token (access or refresh)
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Rotates refresh token: Validates incoming refresh token, checks user status/version,
 * and issues a brand new access token + rotated refresh token.
 */
export async function rotateRefreshToken(oldRefreshToken) {
  if (!oldRefreshToken) {
    return { success: false, status: 400, message: 'Refresh token is required.' };
  }

  const decoded = verifyToken(oldRefreshToken);
  if (!decoded || !decoded.id || decoded.type !== 'refresh') {
    return { success: false, status: 401, message: 'Invalid or expired refresh token.' };
  }

  const user = await UserStore.findById(decoded.id);
  if (!user) {
    return { success: false, status: 401, message: 'User account not found.' };
  }

  if (user.approved === false || user.active === false) {
    return { success: false, status: 403, message: 'Account is pending approval or disabled.' };
  }

  // Token version check (revocation guard)
  if (decoded.tokenVersion && user.tokenVersion && decoded.tokenVersion < user.tokenVersion) {
    return { success: false, status: 401, message: 'Session has been revoked due to security changes. Please log in again.' };
  }

  // Issue rotated token pair
  const tokens = generateAuthTokens(user);

  return {
    success: true,
    data: {
      ...tokens,
      user: {
        _id: user._id || user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    }
  };
}
