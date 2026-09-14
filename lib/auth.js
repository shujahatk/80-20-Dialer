import jwt from 'jsonwebtoken';
import { UserStore } from './store.js';
import { connectDB } from './db.js';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL SECURITY ERROR: JWT_SECRET environment variable is missing in production.');
    }
    return 'super_secret_jwt_key_development_only_change_in_production';
  }
  return secret;
}

export function generateToken(id, tokenVersion = 1) {
  const userId = typeof id === 'object' && id ? (id._id || id.id) : id;
  const version = typeof id === 'object' && id ? (id.tokenVersion || 1) : tokenVersion;
  return jwt.sign({ id: userId, tokenVersion: version, type: 'access' }, getJwtSecret(), { expiresIn: '15m' });
}

export function generateAccessToken(user) {
  const userId = typeof user === 'object' && user ? (user._id || user.id) : user;
  const tokenVersion = typeof user === 'object' && user ? (user.tokenVersion || 1) : 1;
  const role = typeof user === 'object' && user ? user.role : undefined;
  const email = typeof user === 'object' && user ? user.email : undefined;

  return jwt.sign(
    { id: userId, role, email, tokenVersion, type: 'access' },
    getJwtSecret(),
    { expiresIn: '15m' }
  );
}

export function generateRefreshToken(user) {
  const userId = typeof user === 'object' && user ? (user._id || user.id) : user;
  const tokenVersion = typeof user === 'object' && user ? (user.tokenVersion || 1) : 1;

  return jwt.sign(
    { id: userId, tokenVersion, type: 'refresh' },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
}

export function generateAuthTokens(user) {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(user),
    expiresIn: 900,
    tokenType: 'Bearer'
  };
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (err) {
    return null;
  }
}

/**
 * Extracts auth token from either Authorization header OR HttpOnly cookie.
 */
export function extractToken(req) {
  if (!req) return null;

  // 1. Check Authorization Bearer Header
  if (req.headers) {
    let authHeader = null;
    if (typeof req.headers.get === 'function') {
      authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    } else {
      authHeader = req.headers['authorization'] || req.headers['Authorization'] || req.headers.authorization;
    }

    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.split(' ')[1];
    }
  }

  // 2. Check Cookie
  if (req.cookies) {
    if (typeof req.cookies.get === 'function') {
      const cookie = req.cookies.get('auth_token') || req.cookies.get('accessToken');
      if (cookie?.value) return cookie.value;
    } else if (typeof req.cookies === 'object') {
      const cookieVal = req.cookies['auth_token'] || req.cookies['accessToken'];
      if (cookieVal) return cookieVal;
    }
  }

  // 3. Fallback check raw Cookie header
  let cookieHeader = null;
  if (req.headers) {
    if (typeof req.headers.get === 'function') {
      cookieHeader = req.headers.get('cookie');
    } else {
      cookieHeader = req.headers['cookie'];
    }
  }

  if (cookieHeader) {
    const match = cookieHeader.match(/(?:auth_token|accessToken)=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  return null;
}

export async function verifyAuth(req) {
  await connectDB();

  const token = extractToken(req);
  if (!token) {
    return null;
  }

  const decoded = verifyToken(token);
  if (!decoded || !decoded.id) {
    return null;
  }

  const user = await UserStore.findById(decoded.id);
  if (!user) return null;

  // Immediate Revocation: Reject unapproved or disabled accounts
  if (user.approved === false || user.active === false) {
    return null;
  }

  // Token Versioning Revocation: Invalidate tokens issued prior to password resets
  if (decoded.tokenVersion && user.tokenVersion && decoded.tokenVersion < user.tokenVersion) {
    console.warn(`[Auth Revocation]: Token version mismatch for user ${user.email} (token: ${decoded.tokenVersion}, user: ${user.tokenVersion}). Session revoked.`);
    return null;
  }

  return user;
}
