/**
 * Production Environment Configuration & Secret Validator
 * Verifies mandatory production environment variables are present.
 * Prevents system startup with default or fallback secret keys in production.
 */

export function validateEnvironment() {
  const isProduction = process.env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  const requiredInProduction = [
    'JWT_SECRET',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_API_KEY',
    'TWILIO_API_SECRET',
    'TWILIO_TWIML_APP_SID',
    'TWILIO_PHONE_NUMBER',
    'RESEND_API_KEY',
    'RESEND_WEBHOOK_SECRET',
    'CLAUDE_API_KEY'
  ];

  // 1. Secret Predictability Check
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret === 'super_secret_jwt_key_change_in_production') {
    if (isProduction) {
      errors.push('CRITICAL: JWT_SECRET is set to predictable default fallback. A strong secret key MUST be provided in production.');
    } else {
      warnings.push('WARNING: Using default fallback JWT_SECRET for local development.');
    }
  }

  // 2. Production Secret Presence Check
  if (isProduction) {
    for (const key of requiredInProduction) {
      if (!process.env[key]) {
        errors.push(`CRITICAL: Mandatory environment variable '${key}' is missing in production configuration.`);
      }
    }
  }

  // 3. Twilio Credential Format Validations
  const twilioErrors = validateTwilioConfig(false);
  if (isProduction && twilioErrors.length > 0) {
    errors.push(...twilioErrors);
  } else if (!isProduction && twilioErrors.length > 0) {
    warnings.push(...twilioErrors);
  }

  if (errors.length > 0) {
    console.error('\n=== PRODUCTION ENVIRONMENT VALIDATION FAILURE ===');
    errors.forEach(e => console.error(` ❌ ${e}`));
    console.error('=================================================\n');

    if (isProduction) {
      throw new Error(`Environment validation failed with ${errors.length} error(s). System startup aborted.`);
    }
  }

  if (warnings.length > 0 && !isProduction) {
    warnings.forEach(w => console.warn(` ⚠️ ${w}`));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validates Twilio specific environment variables and formats.
 * @param {boolean} throwOnError - whether to throw an Error on validation failure
 * @returns {string[]} array of validation error messages
 */
export function validateTwilioConfig(throwOnError = false) {
  const errors = [];
  const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER,
    TWILIO_API_KEY,
    TWILIO_API_SECRET,
    TWILIO_TWIML_APP_SID,
    PUBLIC_URL
  } = process.env;

  if (TWILIO_ACCOUNT_SID && !TWILIO_ACCOUNT_SID.startsWith('AC')) {
    errors.push('TWILIO_ACCOUNT_SID must begin with "AC"');
  }
  if (TWILIO_API_KEY && !TWILIO_API_KEY.startsWith('SK')) {
    errors.push('TWILIO_API_KEY must begin with "SK"');
  }
  if (TWILIO_TWIML_APP_SID && !TWILIO_TWIML_APP_SID.startsWith('AP')) {
    errors.push('TWILIO_TWIML_APP_SID must begin with "AP"');
  }
  if (TWILIO_PHONE_NUMBER && !/^\+[1-9]\d{1,14}$/.test(TWILIO_PHONE_NUMBER.replace(/\s+/g, ''))) {
    errors.push('TWILIO_PHONE_NUMBER must be in E.164 format (e.g. +1234567890)');
  }
  if (PUBLIC_URL) {
    try {
      const parsed = new URL(PUBLIC_URL);
      if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        errors.push('PUBLIC_URL must use HTTPS in production');
      }
    } catch {
      errors.push('PUBLIC_URL must be a valid URL');
    }
  }

  if (throwOnError && errors.length > 0) {
    throw new Error(`Twilio configuration error: ${errors.join(', ')}`);
  }

  return errors;
}

// Auto-run validation on module import
try {
  validateEnvironment();
} catch (e) {
  if (process.env.NODE_ENV === 'production') {
    throw e;
  }
}
