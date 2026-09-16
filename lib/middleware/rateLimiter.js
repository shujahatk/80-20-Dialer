import { NextResponse } from 'next/server.js';

/**
 * Enterprise Authentication & Brute-Force Rate Limiter Engine
 * Strictly enforces a 5-attempt threshold per 15-minute window across all auth routes.
 * Locks out offending IP/Email combinations for 15 minutes (HTTP 429).
 */

export const MAX_AUTH_ATTEMPTS = 5;
export const AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const AUTH_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

const authAttemptsStore = new Map(); // key -> { count: number, firstAttemptAt: number, lockedUntil: number | null }

// Periodic cleanup of expired entries every 60 seconds
if (typeof setInterval !== 'undefined') {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of authAttemptsStore.entries()) {
      if (record.lockedUntil && now >= record.lockedUntil) {
        authAttemptsStore.delete(key);
      } else if (!record.lockedUntil && now - record.firstAttemptAt > AUTH_WINDOW_MS) {
        authAttemptsStore.delete(key);
      }
    }
  }, 60000);
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
}

/**
 * Extracts normalized client IP address from incoming Request
 */
export function extractClientIp(req) {
  if (!req) return '127.0.0.1';
  if (typeof req.headers?.get === 'function') {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    const realIp = req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip');
    if (realIp) return realIp.trim();
  } else if (req.headers) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return String(forwarded).split(',')[0].trim();
    }
    const realIp = req.headers['x-real-ip'] || req.headers['cf-connecting-ip'];
    if (realIp) return String(realIp).trim();
  }
  return '127.0.0.1';
}

function createRateLimitResponse(minutesLeft) {
  const payload = {
    success: false,
    error: {
      code: 'AUTH_RATE_LIMITED',
      message: `Too many attempts on this authentication endpoint (max ${MAX_AUTH_ATTEMPTS} per 15 minutes). Please try again in ${minutesLeft} minute(s).`
    }
  };

  return NextResponse.json(payload, {
    status: 429,
    headers: {
      'Retry-After': String(minutesLeft * 60)
    }
  });
}

/**
 * Checks whether an auth attempt is allowed under the 5 attempts / 15-minute rule
 */
export function checkLoginRateLimit(identifier) {
  return checkAuthRateLimitByIdentifier(identifier);
}

export function checkAuthRateLimitByIdentifier(identifier, maxAttempts = MAX_AUTH_ATTEMPTS, windowMs = AUTH_WINDOW_MS) {
  if (!identifier) return { allowed: true, remainingAttempts: maxAttempts };

  const key = String(identifier).toLowerCase().trim();
  const record = authAttemptsStore.get(key);
  const now = Date.now();

  if (!record) {
    return { allowed: true, remainingAttempts: maxAttempts };
  }

  // If locked out
  if (record.lockedUntil && now < record.lockedUntil) {
    const minutesLeft = Math.max(1, Math.ceil((record.lockedUntil - now) / 60000));
    return {
      allowed: false,
      locked: true,
      lockoutMinutes: minutesLeft,
      errorResponse: createRateLimitResponse(minutesLeft)
    };
  }

  // If window expired and not locked out, reset
  if (now - record.firstAttemptAt > windowMs) {
    authAttemptsStore.delete(key);
    return { allowed: true, remainingAttempts: maxAttempts };
  }

  const remaining = Math.max(0, maxAttempts - record.count);
  return { allowed: true, remainingAttempts: remaining };
}

/**
 * Convenience helper to check auth rate limit directly from Request and identifier
 */
export function checkAuthRateLimit(req, identifier = '', action = 'auth', maxAttempts = MAX_AUTH_ATTEMPTS) {
  const ip = extractClientIp(req);
  const compositeKey = `${action}_${identifier ? identifier.toLowerCase().trim() + '_' : ''}${ip}`;
  return checkAuthRateLimitByIdentifier(compositeKey, maxAttempts);
}

/**
 * Record a failed auth attempt or request attempt
 */
export function recordFailedLogin(identifier) {
  return recordFailedAuthByIdentifier(identifier);
}

export function recordFailedAuthByIdentifier(identifier, maxAttempts = MAX_AUTH_ATTEMPTS, windowMs = AUTH_WINDOW_MS, lockoutMs = AUTH_LOCKOUT_MS) {
  if (!identifier) return;

  const key = String(identifier).toLowerCase().trim();
  const now = Date.now();
  const record = authAttemptsStore.get(key);

  if (!record || (now - record.firstAttemptAt > windowMs && !record.lockedUntil)) {
    authAttemptsStore.set(key, { count: 1, firstAttemptAt: now, lockedUntil: null });
    return;
  }

  record.count += 1;

  if (record.count >= maxAttempts) {
    record.lockedUntil = now + lockoutMs;
    console.warn(`🔒 [Auth Rate Limiter]: Identifier '${key}' locked for 15 minutes after ${record.count} attempts.`);
  }
}

export function recordFailedAuth(req, identifier = '', action = 'auth') {
  const ip = extractClientIp(req);
  const compositeKey = `${action}_${identifier ? identifier.toLowerCase().trim() + '_' : ''}${ip}`;
  recordFailedAuthByIdentifier(compositeKey);
}

/**
 * Clear failed attempts upon successful authentication
 */
export function clearLoginRateLimit(identifier) {
  clearAuthRateLimitByIdentifier(identifier);
}

export function clearAuthRateLimitByIdentifier(identifier) {
  if (!identifier) return;
  const key = String(identifier).toLowerCase().trim();
  authAttemptsStore.delete(key);
}

export function clearAuthRateLimit(req, identifier = '', action = 'auth') {
  const ip = extractClientIp(req);
  const compositeKey = `${action}_${identifier ? identifier.toLowerCase().trim() + '_' : ''}${ip}`;
  clearAuthRateLimitByIdentifier(compositeKey);
}
