/**
 * Lead Validation Rules
 * 
 * Minimum Rule: A lead is valid if it has at least ONE working contact channel:
 * - valid non-empty email
 * - OR valid non-empty phone number
 */
export function validateLead(normalizedLead) {
  if (!normalizedLead) {
    return {
      isValid: false,
      reason: 'Empty lead record'
    };
  }

  const hasEmail = Boolean(normalizedLead.email && normalizedLead.email.trim() !== '');
  const hasPhone = Boolean(normalizedLead.phone && normalizedLead.phone.trim() !== '');

  if (!hasEmail && !hasPhone) {
    return {
      isValid: false,
      reason: 'Missing both valid email and usable phone number'
    };
  }

  return {
    isValid: true,
    reason: null
  };
}
