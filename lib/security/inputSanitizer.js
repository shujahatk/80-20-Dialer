import { NextResponse } from 'next/server.js';

/**
 * Enterprise Input Sanitization & Payload Protection Engine
 * Guardrails against:
 * 1. Payload bombs / Oversized buffer exhaustion (HTTP 413)
 * 2. Malformed JSON / Prototype pollution (HTTP 400)
 * 3. Stored/Reflected Cross-Site Scripting (XSS)
 * 4. Control character & null-byte injection
 */

export const DEFAULT_MAX_JSON_SIZE_BYTES = 1024 * 1024; // 1 MB
export const DEFAULT_MAX_CSV_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Strips script tags, javascript: schemes, event handlers, and dangerous HTML
 * while preserving legitimate text, punctuation, numbers, and emojis.
 */
export function sanitizeText(input, maxLength = 10000) {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'string') {
    if (typeof input === 'number' || typeof input === 'boolean') return String(input);
    return '';
  }

  let sanitized = input
    // Remove null bytes and control characters (except newline, tab, carriage return)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Remove script tags and contents
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove all HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove javascript: and data: URI schemes
    .replace(/javascript\s*:/gi, 'x-javascript:')
    .replace(/vbscript\s*:/gi, 'x-vbscript:')
    .replace(/data\s*:\s*text\/html/gi, 'x-data:')
    .trim();

  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
  }

  return sanitized;
}

/**
 * Recursively sanitizes all string fields in an object or array.
 * Rejects prototype pollution keys (__proto__, constructor, prototype).
 */
export function sanitizeObject(obj, depth = 0) {
  if (depth > 15) return obj; // Prevent infinite recursion on deeply nested payloads
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return sanitizeText(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
      // Prototype pollution defense
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      const cleanKey = sanitizeText(key, 100);
      clean[cleanKey] = sanitizeObject(value, depth + 1);
    }
    return clean;
  }

  return obj;
}

/**
 * Safely parses and sanitizes incoming Request JSON with strict size and schema checks
 */
export async function parseAndSanitizeJson(req, options = {}) {
  const maxSizeBytes = options.maxSizeBytes || DEFAULT_MAX_JSON_SIZE_BYTES;
  const requiredFields = options.requiredFields || [];

  // 1. Content-Length check (fast rejection before reading body)
  const contentLengthHeader = req.headers?.get?.('content-length') || req.headers?.['content-length'];
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!isNaN(contentLength) && contentLength > maxSizeBytes) {
      return {
        success: false,
        errorResponse: NextResponse.json(
          {
            success: false,
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: `Payload exceeds maximum permitted size of ${Math.round(maxSizeBytes / 1024)} KB.`
            }
          },
          { status: 413 }
        )
      };
    }
  }

  // 2. Read and Parse Body
  let rawBodyText = '';
  try {
    rawBodyText = await req.text();
  } catch (readErr) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST_BODY',
            message: 'Unable to read request stream.'
          }
        },
        { status: 400 }
      )
    };
  }

  if (!rawBodyText || !rawBodyText.trim()) {
    if (requiredFields.length > 0) {
      return {
        success: false,
        errorResponse: NextResponse.json(
          {
            success: false,
            error: {
              code: 'EMPTY_PAYLOAD',
              message: 'Request body cannot be empty.'
            }
          },
          { status: 400 }
        )
      };
    }
    return { success: true, data: {} };
  }

  if (Buffer.byteLength(rawBodyText, 'utf8') > maxSizeBytes) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: `Payload exceeds maximum permitted size of ${Math.round(maxSizeBytes / 1024)} KB.`
          }
        },
        { status: 413 }
      )
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBodyText);
  } catch (jsonErr) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: 'MALFORMED_JSON',
            message: 'Invalid JSON payload provided.'
          }
        },
        { status: 400 }
      )
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      success: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_PAYLOAD_STRUCTURE',
            message: 'JSON payload must be an object or array.'
          }
        },
        { status: 400 }
      )
    };
  }

  // 3. Required Fields Verification
  for (const field of requiredFields) {
    if (parsed[field] === undefined || parsed[field] === null || (typeof parsed[field] === 'string' && !parsed[field].trim())) {
      return {
        success: false,
        errorResponse: NextResponse.json(
          {
            success: false,
            error: {
              code: 'MISSING_REQUIRED_FIELD',
              message: `Required field '${field}' is missing or empty.`
            }
          },
          { status: 400 }
        )
      };
    }
  }

  // 4. Recursive Sanitization
  const sanitized = sanitizeObject(parsed);
  return { success: true, data: sanitized };
}
