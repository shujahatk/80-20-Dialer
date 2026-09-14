import { UserStore } from './stores/users.js';
import { verifyToken, generateAccessToken } from './auth/jwt.js';
export { verifyToken, generateAccessToken, generateRefreshToken } from './auth/jwt.js';
export { generateAuthTokens } from './auth/tokenManager.js';
export function generateToken(user, version = 1) { return generateAccessToken(user, version); }
export function extractCookie(req, name) {
  const cookie = req.cookies?.get?.(name);
  if (cookie?.value) return cookie.value;
  if (typeof req.cookies?.[name] === 'string') return req.cookies[name];
  const header = req.headers?.get?.('cookie') || req.headers?.cookie || '';
  const pair = header.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return null; }
}
export function extractToken(req) {
  if (!req) return null;
  const header = req.headers?.get?.('authorization') || req.headers?.authorization || req.headers?.Authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return extractCookie(req, 'auth_token') || extractCookie(req, 'accessToken');
}
export async function verifyAuth(req) {
  const token = extractToken(req);
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded?.id || decoded.type !== 'access' || !Number.isInteger(decoded.tokenVersion)) return null;
  const user = await UserStore.findById(decoded.id);
  if (!user || user.approved !== true || user.active !== true) return null;
  if (decoded.tokenVersion !== (user.tokenVersion || 1)) return null;
  return user;
}
