/**
 * Validates phone numbers against E.164 format requirements.
 * E.164 format: +[country_code][subscriber_number]
 */
export const validatePhoneNumber = (phone) => {
  if (!phone || typeof phone !== 'string') {
    return {
      isValid: false,
      message: 'Phone number is required.'
    };
  }

  const trimmed = phone.trim();
  const e164Regex = /^\+[1-9]\d{6,14}$/;

  if (!e164Regex.test(trimmed)) {
    return {
      isValid: false,
      message: 'Invalid phone number format. Must start with + and include country code (e.g. +923001234567 or +14155552671).'
    };
  }

  return {
    isValid: true,
    formattedPhone: trimmed
  };
};
