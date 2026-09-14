/**
 * Validates phone numbers against E.164 format requirements.
 * Automatically handles standard US and international numbers, stripping spaces/dashes/brackets.
 * E.164 format: +[country_code][subscriber_number]
 */
export const validatePhoneNumber = (phone) => {
  if (!phone || typeof phone !== 'string') {
    return {
      isValid: false,
      message: 'Phone number is required.'
    };
  }

  let cleaned = phone.trim().replace(/[\s\(\)\-\.]/g, '');
  if (!cleaned.startsWith('+')) {
    // If 10 digits (US/NANP number), assume +1
    if (/^\d{10}$/.test(cleaned)) {
      cleaned = '+1' + cleaned;
    } else if (/^1\d{10}$/.test(cleaned)) {
      cleaned = '+' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }

  const e164Regex = /^\+[1-9]\d{6,14}$/;

  if (!e164Regex.test(cleaned)) {
    return {
      isValid: false,
      message: 'Invalid phone number format. Must start with + and include country code (e.g. +14155552671).'
    };
  }

  return {
    isValid: true,
    formattedPhone: cleaned
  };
};
