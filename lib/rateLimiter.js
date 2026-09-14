import { NextResponse } from 'next/server';

const localRateLimitStore = new Map();

// Periodic cleanup of expired local rate limit entries every 60 seconds
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of localRateLimitStore.entries()) {
      if (now > entry.resetTime) {
        localRateLimitStore.delete(key);
      }
    }
  }, 60000);
}

/**
 * Enforces rate limiting on API requests across single or multi-region serverless deployments.
 * Supports Upstash Redis REST API when configured, with an in-memory fallback.
 * @param {string} identifier - Unique key (IP, User ID, or Email)
 * @param {number} limit - Maximum allowed requests in window (default 20)
 * @param {number} windowMs - Time window in milliseconds (default 60000ms / 1 min)
 * @returns {Promise<{ success: boolean, errorResponse?: NextResponse, remaining: number, resetTime: number }>}
 */
export async function checkRateLimitAsync(identifier, limit = 20, windowMs = 60000) {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    try {
      const key = `ratelimit:${identifier}`;
      const expireSeconds = Math.ceil(windowMs / 1000);
      
      // Upstash REST Pipeline: INCR and EXPIRE
      const response = await fetch(`${redisUrl}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redisToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([
          ['INCR', key],
          ['EXPIRE', key, expireSeconds]
        ])
      });

      if (response.ok) {
        const results = await response.json();
        const currentCount = results?.[0]?.result || 1;
        const remaining = Math.max(0, limit - currentCount);

        if (currentCount > limit) {
          return {
            success: false,
            remaining: 0,
            resetTime: Date.now() + windowMs,
            errorResponse: NextResponse.json(
              {
                success: false,
                error: {
                  code: 'TOO_MANY_REQUESTS',
                  message: `Rate limit exceeded. Too many requests. Please try again later.`
                }
              },
              { status: 429, headers: { 'Retry-After': String(expireSeconds) } }
            )
          };
        }

        return { success: true, remaining, resetTime: Date.now() + windowMs };
      }
    } catch (err) {
      console.warn('[Distributed Rate Limiter Warning]: Upstash Redis offline/unreachable. Falling back to local store:', err.message);
    }
  }

  // Safe In-Memory Fallback
  return checkRateLimit(identifier, limit, windowMs);
}

/**
 * Synchronous / Local Rate Limiter Check (In-Memory Fallback)
 */
export function checkRateLimit(identifier, limit = 20, windowMs = 60000) {
  const now = Date.now();
  const key = `${identifier}`;

  let entry = localRateLimitStore.get(key);

  if (!entry || now > entry.resetTime) {
    entry = {
      count: 1,
      resetTime: now + windowMs
    };
    localRateLimitStore.set(key, entry);
    return { success: true, remaining: limit - 1, resetTime: entry.resetTime };
  }

  entry.count += 1;

  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    return {
      success: false,
      remaining: 0,
      resetTime: entry.resetTime,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: `Rate limit exceeded. Too many requests. Please try again in ${retryAfter} seconds.`
          }
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter)
          }
        }
      )
    };
  }

  return {
    success: true,
    remaining: limit - entry.count,
    resetTime: entry.resetTime
  };
}
