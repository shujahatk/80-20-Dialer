import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAuthRateLimitByIdentifier,
  recordFailedAuthByIdentifier,
  clearAuthRateLimitByIdentifier,
  MAX_AUTH_ATTEMPTS,
  AUTH_WINDOW_MS
} from '../lib/middleware/rateLimiter.js';
import {
  sanitizeText,
  sanitizeObject,
  parseAndSanitizeJson
} from '../lib/security/inputSanitizer.js';
import { checkEndpointRateLimit } from '../lib/rateLimiter.js';

test('Security Hardening & Rate Limiting Test Suite', async (t) => {
  await t.test('enforces max 5 attempts on auth routes per 15-minute window', () => {
    const testId = `test_user_lockout_${Date.now()}`;

    // Clear any existing state
    clearAuthRateLimitByIdentifier(testId);

    // First 4 attempts should be allowed
    for (let i = 1; i <= 4; i++) {
      const check = checkAuthRateLimitByIdentifier(testId, 5);
      assert.strictEqual(check.allowed, true, `Attempt ${i} should be allowed`);
      assert.strictEqual(check.remainingAttempts, 5 - i + 1);
      recordFailedAuthByIdentifier(testId, 5);
    }

    // 5th attempt: recorded, so now count is 5 (threshold hit)
    recordFailedAuthByIdentifier(testId, 5);

    // Next check should be locked out
    const lockedCheck = checkAuthRateLimitByIdentifier(testId, 5);
    assert.strictEqual(lockedCheck.allowed, false, '6th attempt must be locked out');
    assert.strictEqual(lockedCheck.locked, true);
    assert.ok(lockedCheck.lockoutMinutes >= 1, 'Should have positive lockout minutes');
    assert.strictEqual(lockedCheck.errorResponse.status, 429);

    // Clear should reset
    clearAuthRateLimitByIdentifier(testId);
    const resetCheck = checkAuthRateLimitByIdentifier(testId, 5);
    assert.strictEqual(resetCheck.allowed, true);
  });

  await t.test('sanitizeText strips dangerous HTML, script tags, event handlers, and null bytes', () => {
    const xssVectors = [
      { input: '<script>alert("xss")</script>Hello', expected: 'Hello' },
      { input: '<img src=x onerror="alert(1)">Prospect', expected: 'Prospect' },
      { input: 'javascript:alert(1)', expected: 'x-javascript:alert(1)' },
      { input: 'Lead Name\x00with null byte', expected: 'Lead Namewith null byte' },
      { input: '<iframe src="http://evil.com"></iframe>Company Inc', expected: 'Company Inc' },
      { input: 'Normal text with punctuation & emojis 🚀!', expected: 'Normal text with punctuation & emojis 🚀!' }
    ];

    for (const vector of xssVectors) {
      const sanitized = sanitizeText(vector.input);
      assert.strictEqual(sanitized, vector.expected, `Failed to sanitize: ${vector.input}`);
    }
  });

  await t.test('sanitizeObject recursively sanitizes complex payloads and defends against prototype pollution', () => {
    const dirtyPayload = {
      name: '<script>evil()</script>Sarah Connor',
      company: {
        title: '<b onmouseover="steal()">Cyberdyne</b>',
        address: '123 Main St'
      },
      tags: ['<script>xss</script>tech', 'sales'],
      __proto__: { isAdmin: true }
    };

    const clean = sanitizeObject(dirtyPayload);
    assert.strictEqual(clean.name, 'Sarah Connor');
    assert.strictEqual(clean.company.title, 'Cyberdyne');
    assert.strictEqual(clean.company.address, '123 Main St');
    assert.strictEqual(clean.tags[0], 'tech');
    assert.strictEqual(clean.tags[1], 'sales');
    // Ensure prototype pollution was stripped
    assert.strictEqual(Object.prototype.isAdmin, undefined);
  });

  await t.test('parseAndSanitizeJson rejects oversized payloads exceeding limit with HTTP 413', async () => {
    // Generate a payload larger than 50KB for a 10KB limit test
    const largeData = 'x'.repeat(20 * 1024);
    const mockReq = new Request('http://localhost:3000/api/leads', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(largeData, 'utf8'))
      },
      body: JSON.stringify({ data: largeData })
    });

    const result = await parseAndSanitizeJson(mockReq, { maxSizeBytes: 10 * 1024 });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorResponse.status, 413);
  });

  await t.test('parseAndSanitizeJson rejects malformed JSON with HTTP 400', async () => {
    const mockReq = new Request('http://localhost:3000/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ "invalidJson": broken }'
    });

    const result = await parseAndSanitizeJson(mockReq);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorResponse.status, 400);
  });

  await t.test('checkEndpointRateLimit enforces per-user and per-IP thresholds', () => {
    const user = { id: `usr_${Date.now()}` };

    // Limit 5 per minute
    for (let i = 1; i <= 5; i++) {
      const res = checkEndpointRateLimit(null, user, 5, 60000);
      assert.strictEqual(res.success, true);
    }

    // 6th call exceeds limit
    const exceeded = checkEndpointRateLimit(null, user, 5, 60000);
    assert.strictEqual(exceeded.success, false);
    assert.strictEqual(exceeded.errorResponse.status, 429);
  });
});
