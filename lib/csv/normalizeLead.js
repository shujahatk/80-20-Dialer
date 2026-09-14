/**
 * Lead Data Normalization & Sanitization Utilities
 */

const DIRTY_VALUE_SET = new Set([
  '',
  'null',
  'undefined',
  'n/a',
  'na',
  'none',
  'unknown',
  '-',
  '--',
  'nil',
  'nan'
]);

/**
 * Checks if a string value is considered empty, dirty, or a placeholder.
 */
export function isDirtyOrEmpty(val) {
  if (val === null || val === undefined) return true;
  const str = String(val).trim().toLowerCase();
  return DIRTY_VALUE_SET.has(str);
}

/**
 * Sanitizes an arbitrary CSV string value.
 * Converts dirty placeholders to empty string and neutralizes dangerous spreadsheet formulas.
 */
export function sanitizeCsvValue(val) {
  if (isDirtyOrEmpty(val)) return '';
  const trimmed = String(val).trim();

  // Neutralize spreadsheet formula injection (=, +, -, @)
  // Be careful not to prepend apostrophe to legitimate phone numbers starting with '+'
  if (/^[=@]/.test(trimmed)) {
    return "'" + trimmed;
  }
  if (/^[+\-]/.test(trimmed)) {
    // If it's a numeric/phone pattern like +15551234567, do not neutralize
    if (/^[+]\d+[\d\s\-\(\)\.]*$/.test(trimmed)) {
      return trimmed;
    }
    return "'" + trimmed;
  }

  return trimmed;
}

/**
 * Normalizes email address.
 * Converts to lowercase, strips accidental whitespace, and validates syntax.
 */
export function normalizeEmail(rawEmail) {
  if (isDirtyOrEmpty(rawEmail)) return null;

  const cleaned = String(rawEmail)
    .trim()
    .replace(/\s+/g, '') // remove accidental spaces
    .toLowerCase();

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(cleaned)) {
    return null;
  }

  return cleaned;
}

/**
 * Normalizes phone numbers while preserving international '+' prefix.
 */
export function normalizePhone(rawPhone) {
  if (isDirtyOrEmpty(rawPhone)) return null;

  let str = String(rawPhone).trim();

  // Determine if leading '+' exists
  const hasPlus = str.startsWith('+');

  // Strip all non-digits
  const digits = str.replace(/\D/g, '');

  // Must have at least 6 digits to be considered a usable phone number
  if (digits.length < 6 || digits.length > 17) {
    return null;
  }

  return (hasPlus ? '+' : '') + digits;
}

/**
 * Constructs a clean full name from raw full_name, first_name, and last_name.
 */
export function constructName(rawFullName, rawFirstName, rawLastName) {
  const full = sanitizeCsvValue(rawFullName);
  if (full && !isDirtyOrEmpty(full)) {
    return full;
  }

  const first = sanitizeCsvValue(rawFirstName);
  const last = sanitizeCsvValue(rawLastName);

  const parts = [];
  if (first && !isDirtyOrEmpty(first)) parts.push(first);
  if (last && !isDirtyOrEmpty(last)) parts.push(last);

  const combined = parts.join(' ').trim();
  return combined || 'N/A';
}

/**
 * Normalizes a single raw CSV row using the computed column map.
 */
export function normalizeLeadRow(row, columnMap, defaultList = '') {
  const getVal = (field) => {
    const rawHeader = columnMap[field];
    if (!rawHeader || row[rawHeader] === undefined) return '';
    return sanitizeCsvValue(row[rawHeader]);
  };

  const name = constructName(getVal('name'), getVal('first_name'), getVal('last_name'));
  const email = normalizeEmail(getVal('email'));
  const phone = normalizePhone(getVal('phone'));
  const company = getVal('company');
  const position = getVal('position');
  const website = getVal('website');
  const niche = getVal('niche');
  const city = getVal('city');
  const region = getVal('region');
  const country = getVal('country');
  const timezone = getVal('timezone') || 'UTC';
  const listName = getVal('list') || defaultList || '';
  const source = getVal('source') || 'csv_import';
  const priority = parseInt(getVal('priority')) || 0;

  return {
    name,
    email,
    phone,
    company: company || '',
    position: position || '',
    website: website || '',
    niche: niche || '',
    city: city || '',
    region: region || '',
    country: country || '',
    timezone: timezone || 'UTC',
    priority,
    list: listName,
    source,
    contact: {
      name,
      email: email || '',
      phone: phone || '',
      position: position || '',
      preferredChannel: ''
    },
    companyObj: {
      name: company || '',
      website: website || '',
      niche: niche || '',
      notes: ''
    },
    geography: {
      city: city || '',
      region: region || '',
      country: country || '',
      timezone: timezone || 'UTC'
    },
    assignment: {
      list: listName,
      priority,
      source
    }
  };
}
