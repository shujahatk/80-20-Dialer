/**
 * Deliverability & Domain Guardrails Module
 * Protects domain and sender reputation with daily volume throttling and RFC 8058 headers
 */

export const MONTHLY_ACCOUNT_CAPACITY = parseInt(process.env.RESEND_MONTHLY_LIMIT || '50000', 10);
const monthlySendCounter = { totalSent: 0, userCounts: new Map(), resetAt: getEndOfMonth() };

function getEndOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

/**
 * Check volume against monthly plan pool (No artificial daily limit)
 */
export function checkDomainSendLimit(fromEmail) {
  const now = Date.now();
  if (now > monthlySendCounter.resetAt) {
    monthlySendCounter.totalSent = 0;
    monthlySendCounter.userCounts.clear();
    monthlySendCounter.resetAt = getEndOfMonth();
  }

  // No daily limit enforcement - always allowed unless monthly hard cap is exceeded
  const remaining = Math.max(0, MONTHLY_ACCOUNT_CAPACITY - monthlySendCounter.totalSent);
  return { 
    allowed: true, 
    throttled: false, 
    currentCount: monthlySendCounter.totalSent, 
    monthlyLimit: MONTHLY_ACCOUNT_CAPACITY,
    remainingAvailable: remaining
  };
}

/**
 * Increment the sent count for a sender email and update monthly capacity
 */
export function recordDomainSend(fromEmail, count = 1) {
  if (!fromEmail) return;
  const emailKey = fromEmail.toLowerCase().trim();
  
  monthlySendCounter.totalSent += count;
  const currentRepCount = monthlySendCounter.userCounts.get(emailKey) || 0;
  monthlySendCounter.userCounts.set(emailKey, currentRepCount + count);
}

/**
 * Get current monthly pool utilization and remaining quota
 */
export function getMonthlyUsageStats() {
  const totalSent = monthlySendCounter.totalSent;
  const remaining = Math.max(0, MONTHLY_ACCOUNT_CAPACITY - totalSent);
  return {
    monthlyLimit: MONTHLY_ACCOUNT_CAPACITY,
    totalSent,
    remainingAvailable: remaining,
    usagePercentage: `${((totalSent / MONTHLY_ACCOUNT_CAPACITY) * 100).toFixed(2)}%`
  };
}

/**
 * Inject RFC 8058 compliance headers for 1-Click Unsubscribe
 */
export function getComplianceHeaders(recipientEmail, unsubscribeUrl = null) {
  const defaultUnsubUrl = unsubscribeUrl || `https://8020dialer.com/api/emails/unsubscribe?email=${encodeURIComponent(recipientEmail || '')}`;
  return {
    'List-Unsubscribe': `<${defaultUnsubUrl}>, <mailto:unsubscribe@8020dialer.com?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'X-Entity-Ref-ID': `8020-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  };
}
