// lib/auth/passwordValidator.js

/**
 * Validates password complexity according to enterprise security standards:
 * - At least 8 characters long
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one number (0-9)
 * - At least one special character (!@#$%^&*...)
 */
export function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }

  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password);

  if (password.length < minLength) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (!hasUpperCase) {
    return { valid: false, error: 'Password must contain at least one uppercase letter.' };
  }
  if (!hasLowerCase) {
    return { valid: false, error: 'Password must contain at least one lowercase letter.' };
  }
  if (!hasNumber) {
    return { valid: false, error: 'Password must contain at least one number.' };
  }
  if (!hasSpecialChar) {
    return { valid: false, error: 'Password must contain at least one special character.' };
  }

  return { valid: true, error: null };
}

/**
 * Returns an object with boolean flags for each individual password requirement.
 * Useful for real-time frontend UI feedback.
 */
export function checkPasswordCriteria(password = '') {
  return {
    minLength: password.length >= 8,
    hasUpperCase: /[A-Z]/.test(password),
    hasLowerCase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password),
    allPassed:
      password.length >= 8 &&
      /[A-Z]/.test(password) &&
      /[a-z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)
  };
}
