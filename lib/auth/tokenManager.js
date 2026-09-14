import { createHash } from 'node:crypto';
import { UserStore } from '../stores/users.js';
import { getSupabaseClient, queryResult } from '../supabase.js';
import { generateAccessToken, generateRefreshToken, verifyToken } from './jwt.js';
export { generateAccessToken, generateRefreshToken, verifyToken } from './jwt.js';
const hash = token => createHash('sha256').update(token).digest('hex');
function tokenPair(user) {
  return { accessToken: generateAccessToken(user), refreshToken: generateRefreshToken(user), expiresIn: 900, tokenType: 'Bearer' };
}
function session(token) {
  const decoded = verifyToken(token);
  return { user_id: decoded.id, token_hash: hash(token), refresh_token_jti: decoded.jti, expires_at: new Date(decoded.exp * 1000).toISOString() };
}
export async function generateAuthTokens(user) {
  const tokens = tokenPair(user);
  await queryResult(getSupabaseClient().from('refresh_sessions').insert(session(tokens.refreshToken)));
  return tokens;
}
export const generateTokens = generateAuthTokens;
export async function rotateRefreshToken(oldToken) {
  const decoded = verifyToken(oldToken);
  if (!decoded?.id || decoded.type !== 'refresh' || !decoded.jti || !Number.isInteger(decoded.tokenVersion)) {
    return { success: false, status: 401, message: 'Invalid or expired refresh token.' };
  }
  const user = await UserStore.findById(decoded.id);
  if (!user || user.approved !== true || user.active !== true || decoded.tokenVersion !== (user.tokenVersion || 1)) {
    return { success: false, status: 401, message: 'Session revoked.' };
  }
  const tokens = tokenPair(user);
  const next = session(tokens.refreshToken);
  const rotated = await queryResult(getSupabaseClient().rpc('rotate_outbound_refresh', {
    p_old_hash: hash(oldToken), p_user: user.id, p_version: decoded.tokenVersion,
    p_new_hash: next.token_hash, p_new_jti: next.refresh_token_jti, p_expires: next.expires_at
  }));
  if (!rotated) return { success: false, status: 401, message: 'Refresh token already used or revoked. Please log in again.' };
  return { success: true, data: { ...tokens, user: { _id: user.id, name: user.name, email: user.email, role: user.role } } };
}
export async function revokeRefreshToken(token) {
  if (!token) return;
  await queryResult(getSupabaseClient().from('refresh_sessions').update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', hash(token)).is('revoked_at', null));
}
