/**
 * Brute-Force Rate Limiter & Account Lockout Engine
 * Tracks failed login attempts by IP / Email
 * 5 failed attempts in 10 minutes -> 15-minute lockout (429)
 */

const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const loginAttemptsStore = new Map(); // key -> { count: number, firstAttemptAt: number, lockedUntil: number | null }

function createRateLimitResponse(minutesLeft) {
  const payload = {
    success: false,
    code: 'AUTH_RATE_LIMITED',
    message: `Too many failed login attempts. Account/IP temporarily locked for security. Please try again in ${minutesLeft} minute(s).`
  };

  try {
    const { NextResponse } = require('next/server');
    return NextResponse.json(payload, { status: 429 });
  } catch (e) {
    return { status: 429, json: () => payload, ...payload };
  }
}

/**
 * Check if the given identifier (IP/Email) is currently locked out
 */
export function checkLoginRateLimit(identifier) {
  if (!identifier) return { allowed: true };

  const key = identifier.toLowerCase().trim();
  const record = loginAttemptsStore.get(key);
  const now = Date.now();

  if (!record) {
    return { allowed: true, remainingAttempts: MAX_FAILED_ATTEMPTS };
  }

  // If locked out
  if (record.lockedUntil && now < record.lockedUntil) {
    const minutesLeft = Math.ceil((record.lockedUntil - now) / 60000);
    return {
      allowed: false,
      locked: true,
      lockoutMinutes: minutesLeft,
      errorResponse: createRateLimitResponse(minutesLeft)
    };
  }

  // If window expired, reset
  if (now - record.firstAttemptAt > ATTEMPT_WINDOW_MS) {
    loginAttemptsStore.delete(key);
    return { allowed: true, remainingAttempts: MAX_FAILED_ATTEMPTS };
  }

  const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - record.count);
  return { allowed: true, remainingAttempts: remaining };
}

/**
 * Record a failed login attempt. Locks the identifier if threshold is hit.
 */
export function recordFailedLogin(identifier) {
  if (!identifier) return;

  const key = identifier.toLowerCase().trim();
  const now = Date.now();
  const record = loginAttemptsStore.get(key);

  if (!record || (now - record.firstAttemptAt > ATTEMPT_WINDOW_MS && !record.lockedUntil)) {
    loginAttemptsStore.set(key, { count: 1, firstAttemptAt: now, lockedUntil: null });
    return;
  }

  record.count += 1;

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
    console.warn(`🔒 [Brute-Force Lockout]: Identifier '${key}' locked for 15 minutes after ${record.count} failed attempts.`);
  }
}

/**
 * Clear failed attempts upon successful authentication
 */
export function clearLoginRateLimit(identifier) {
  if (!identifier) return;
  const key = identifier.toLowerCase().trim();
  loginAttemptsStore.delete(key);
}
