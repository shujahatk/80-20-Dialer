import { FIELD_ALIASES } from './fieldAliases.js';

/**
 * Normalizes an arbitrary header string for reliable matching.
 * Handles:
 * - BOM characters (\uFEFF)
 * - Leading/trailing/duplicate spaces
 * - camelCase (e.g. 'firstName' -> 'first_name')
 * - Hyphens & dots (e.g. 'e-mail' -> 'e_mail', 'first.name' -> 'first_name')
 * - Unnecessary punctuation
 */
export function normalizeHeader(rawHeader) {
  if (!rawHeader || typeof rawHeader !== 'string') return '';

  return rawHeader
    // Strip UTF-8 BOM
    .replace(/^\uFEFF/, '')
    // Trim outer whitespace
    .trim()
    // Convert camelCase to snake_case
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    // Convert to lowercase
    .toLowerCase()
    // Replace hyphens, dots, slashes, spaces with underscore
    .replace(/[\s\-\.\/]+/g, '_')
    // Remove all non-alphanumeric chars except underscore
    .replace(/[^a-z0-9_]/g, '')
    // Collapse duplicate underscores
    .replace(/_+/g, '_')
    // Strip leading/trailing underscores
    .replace(/^_+|_+$/g, '');
}

/**
 * Maps a list of raw CSV header strings to canonical system field keys.
 * Supports manual override mappings.
 * Returns an object containing:
 * - columnMap: { canonicalField: rawHeaderName }
 * - headerSummary: array of { rawHeader, normalizedHeader, mappedField, isIgnored }
 */
export function mapCsvHeaders(headers, manualOverrides = {}) {
  if (!Array.isArray(headers) || headers.length === 0) {
    return { columnMap: {}, headerSummary: [] };
  }

  const columnMap = {};
  const headerSummary = [];
  const mappedRawHeaders = new Set();

  // 1. Process explicit manual overrides first
  if (manualOverrides && typeof manualOverrides === 'object') {
    for (const [rawHeader, targetField] of Object.entries(manualOverrides)) {
      if (targetField && targetField !== 'ignore' && headers.includes(rawHeader)) {
        columnMap[targetField] = rawHeader;
        mappedRawHeaders.add(rawHeader);
      }
    }
  }

  // 2. Pre-normalize all headers
  const normalizedList = headers.map(h => ({
    raw: h,
    normalized: normalizeHeader(h)
  }));

  // 3. Match each canonical system field against known aliases
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (columnMap[field]) continue; // already mapped via manual override

    // Find best matching header in the CSV
    const match = normalizedList.find(item => !mappedRawHeaders.has(item.raw) && aliases.includes(item.normalized));
    if (match) {
      columnMap[field] = match.raw;
      mappedRawHeaders.add(match.raw);
    }
  }

  // 4. Build summary of all columns (including ignored ones)
  for (const item of normalizedList) {
    let mappedField = null;
    for (const [field, rawHeader] of Object.entries(columnMap)) {
      if (rawHeader === item.raw) {
        mappedField = field;
        break;
      }
    }

    headerSummary.push({
      rawHeader: item.raw,
      normalizedHeader: item.normalized,
      mappedField: mappedField,
      isIgnored: mappedField === null
    });
  }

  return { columnMap, headerSummary };
}
