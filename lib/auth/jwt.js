import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required.');
  if (process.env.NODE_ENV === 'production' && (secret.length < 32 || secret.startsWith('super_secret_jwt_key'))) {
    throw new Error('JWT_SECRET must be a strong secret of at least 32 characters in production.');
  }
  return secret;
}
export function generateAccessToken(user, version = 1) {
  const object = typeof user === 'object' && user;
  return jwt.sign({ id: object ? user.id || user._id : user,
    tokenVersion: object ? user.tokenVersion || user.token_version || 1 : version,
    role: object ? user.role : undefined, email: object ? user.email : undefined,
    type: 'access', jti: randomUUID() }, getJwtSecret(), { algorithm: 'HS256', expiresIn: '15m' });
}
export function generateRefreshToken(user) {
  return jwt.sign({ id: user.id || user._id, tokenVersion: user.tokenVersion || user.token_version || 1,
    type: 'refresh', jti: randomUUID() }, getJwtSecret(), { algorithm: 'HS256', expiresIn: '7d' });
}
export function verifyToken(token) {
  const secret = getJwtSecret();
  try { return jwt.verify(token, secret, { algorithms: ['HS256'] }); }
  catch { return null; }
}
