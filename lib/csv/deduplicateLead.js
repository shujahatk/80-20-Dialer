/**
 * Lead Deduplication Engine
 */

export function buildExistingIndex(existingLeads = []) {
  const emailSet = new Set();
  const phoneSet = new Set();

  for (const l of existingLeads) {
    const email = l.email || l.contact?.email;
    const phone = l.phone || l.contact?.phone;

    if (email && typeof email === 'string' && email.trim() !== '') {
      emailSet.add(email.trim().toLowerCase());
    }
    if (phone && typeof phone === 'string' && phone.trim() !== '') {
      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone) phoneSet.add(cleanPhone);
    }
  }

  return { emailSet, phoneSet };
}

/**
 * Checks if a normalized lead matches existing records in DB or the current batch.
 */
export function checkDuplicate(normalizedLead, existingIndex, batchIndex) {
  const email = normalizedLead.email ? normalizedLead.email.trim().toLowerCase() : null;
  const rawPhone = normalizedLead.phone ? normalizedLead.phone.trim() : null;
  const digitsOnlyPhone = rawPhone ? rawPhone.replace(/\D/g, '') : null;

  // 1. Check against DB existing index
  if (email && existingIndex.emailSet.has(email)) {
    return { isDuplicate: true, reason: `Duplicate email (${email}) already exists in system` };
  }
  if (digitsOnlyPhone && existingIndex.phoneSet.has(digitsOnlyPhone)) {
    return { isDuplicate: true, reason: `Duplicate phone (${rawPhone}) already exists in system` };
  }

  // 2. Check against batch index (duplicate within the same CSV file)
  if (email && batchIndex.emailSet.has(email)) {
    return { isDuplicate: true, reason: `Duplicate email (${email}) repeated in upload file` };
  }
  if (digitsOnlyPhone && batchIndex.phoneSet.has(digitsOnlyPhone)) {
    return { isDuplicate: true, reason: `Duplicate phone (${rawPhone}) repeated in upload file` };
  }

  return { isDuplicate: false, reason: null };
}

/**
 * Registers a processed lead into the batch index to prevent intra-file duplicate imports.
 */
export function registerInBatchIndex(normalizedLead, batchIndex) {
  if (normalizedLead.email) {
    batchIndex.emailSet.add(normalizedLead.email.trim().toLowerCase());
  }
  if (normalizedLead.phone) {
    const cleanPhone = normalizedLead.phone.replace(/\D/g, '');
    if (cleanPhone) batchIndex.phoneSet.add(cleanPhone);
  }
}
