import { parseCsvBuffer } from './parseCsv.js';
import { mapCsvHeaders } from './normalizeHeader.js';
import { normalizeLeadRow } from './normalizeLead.js';
import { validateLead } from './validateLead.js';
import { buildExistingIndex, checkDuplicate, registerInBatchIndex } from './deduplicateLead.js';
import { LeadStore, UserStore } from '../store.js';
import { SuppressionStore } from '../suppression/suppressionStore.js';
import { distributeLeadsRoundRobin } from '../distribution/roundRobin.js';
import { syncLeadToListmonk } from '../listmonk.js';

export const MAX_CSV_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
export const MAX_CSV_ROWS = 50000;
export const MAX_CSV_COLUMNS = 100;
export const MAX_CELL_LENGTH = 10000;

/**
 * Universal CSV Lead Processing & Import Orchestrator
 * Supports common CSV structures and automatically maps recognized lead fields.
 */
export async function processCsvUpload({
  csvBufferOrString,
  assignToUserId = 'pool',
  manualOverrides = {},
  duplicateStrategy = 'skip', // 'skip' | 'import_anyway'
  previewOnly = false,
  defaultList = ''
}) {
  // 0. Validate File Buffer / Size
  if (!csvBufferOrString) {
    return {
      success: false,
      message: 'No CSV file content provided.',
      summary: { totalRows: 0, imported: 0, duplicates: 0, invalid: 0, skipped: 0 },
      mappings: [],
      errors: [{ row: 1, reason: 'Empty payload' }]
    };
  }

  const byteLength = Buffer.isBuffer(csvBufferOrString)
    ? csvBufferOrString.length
    : Buffer.byteLength(String(csvBufferOrString), 'utf8');

  if (byteLength > MAX_CSV_FILE_SIZE) {
    return {
      success: false,
      message: `CSV file exceeds maximum supported size of 15 MB (Provided: ${(byteLength / (1024 * 1024)).toFixed(2)} MB).`,
      summary: { totalRows: 0, imported: 0, duplicates: 0, invalid: 0, skipped: 0 },
      mappings: [],
      errors: [{ row: 1, reason: 'File exceeds 15 MB limit' }]
    };
  }

  // 1. Parse CSV buffer/string
  const { rawRows, headers, delimiter, totalCount } = await parseCsvBuffer(csvBufferOrString);

  if (totalCount === 0 || headers.length === 0) {
    return {
      success: false,
      message: 'No readable data rows found in CSV file.',
      summary: { totalRows: 0, imported: 0, duplicates: 0, invalid: 0, skipped: 0 },
      mappings: [],
      errors: [{ row: 1, reason: 'File is empty or contains no data rows' }]
    };
  }

  if (headers.length > MAX_CSV_COLUMNS) {
    return {
      success: false,
      message: `CSV file contains ${headers.length} columns, exceeding the maximum allowed limit of ${MAX_CSV_COLUMNS} columns.`,
      summary: { totalRows: totalCount, imported: 0, duplicates: 0, invalid: 0, skipped: totalCount },
      mappings: [],
      errors: [{ row: 1, reason: `Column count exceeds limit (${headers.length}/${MAX_CSV_COLUMNS})` }]
    };
  }

  if (rawRows.length > MAX_CSV_ROWS) {
    return {
      success: false,
      message: `CSV file contains ${rawRows.length} rows, exceeding the maximum batch limit of ${MAX_CSV_ROWS} rows.`,
      summary: { totalRows: rawRows.length, imported: 0, duplicates: 0, invalid: 0, skipped: rawRows.length },
      mappings: [],
      errors: [{ row: 1, reason: `Row count exceeds limit (${rawRows.length}/${MAX_CSV_ROWS})` }]
    };
  }

  // 2. Compute Header Mapping
  const { columnMap, headerSummary } = mapCsvHeaders(headers, manualOverrides);

  // 3. Load existing leads for deduplication
  const existingLeads = await LeadStore.findAll();
  const existingIndex = buildExistingIndex(existingLeads);
  const batchIndex = { emailSet: new Set(), phoneSet: new Set() };

  const validLeadsToImport = [];
  const duplicateRecords = [];
  const invalidRecords = [];
  const previewSample = [];

  // 4. Process each row independently
  for (let i = 0; i < rawRows.length; i++) {
    const rowNumber = i + 2; // account for 1-based index + header row
    const rawRow = rawRows[i];

    // Normalize
    const normalized = normalizeLeadRow(rawRow, columnMap, defaultList);

    // Validate
    const validation = validateLead(normalized);
    if (!validation.isValid) {
      invalidRecords.push({
        row: rowNumber,
        name: normalized.name,
        email: normalized.email,
        phone: normalized.phone,
        reason: validation.reason
      });
      continue;
    }

    // Deduplicate
    const dupCheck = checkDuplicate(normalized, existingIndex, batchIndex);
    if (dupCheck.isDuplicate) {
      duplicateRecords.push({
        row: rowNumber,
        name: normalized.name,
        email: normalized.email,
        phone: normalized.phone,
        reason: dupCheck.reason
      });

      if (duplicateStrategy === 'skip') {
        continue;
      }
    }

    // Step 3.4: Check permanent suppression / DNC layer
    const suppCheck = await SuppressionStore.isSuppressed({
      email: normalized.email,
      phone: normalized.phone
    });

    if (suppCheck.suppressed) {
      normalized.suppression = {
        email: true,
        sms: true,
        dnc: true,
        reason: suppCheck.reason || 'Previously opted out (Permanent DNC)'
      };
      normalized.coldOutreachStopped = true;
    }

    // Register in batch index to prevent duplicates within this upload
    registerInBatchIndex(normalized, batchIndex);

    validLeadsToImport.push({
      ...normalized,
      rowNumber
    });

    if (previewSample.length < 10) {
      previewSample.push(normalized);
    }
  }


  const summary = {
    totalRows: rawRows.length,
    validRows: validLeadsToImport.length,
    duplicates: duplicateRecords.length,
    invalid: invalidRecords.length,
    skipped: (rawRows.length - validLeadsToImport.length),
    imported: 0
  };

  // If preview mode, return analysis without writing to DB
  if (previewOnly) {
    return {
      success: true,
      preview: true,
      summary,
      headers,
      delimiter,
      headerSummary,
      columnMap,
      sampleRows: previewSample,
      duplicateList: duplicateRecords.slice(0, 15),
      invalidList: invalidRecords.slice(0, 15)
    };
  }

  // 5. Database Insertion & Assignment
  let insertedCount = 0;
  if (validLeadsToImport.length > 0) {
    const isRoundRobin = assignToUserId === 'round_robin';
    const isPool = !assignToUserId || assignToUserId === 'pool' || assignToUserId === 'unassigned';
    const targetAssignedTo = isPool ? null : String(assignToUserId);
    const targetStatus = isPool ? 'new' : 'assigned';
    const now = new Date().toISOString();

    let dbRows = validLeadsToImport.map(l => ({
      _id: 'lead_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      name: l.name || 'N/A',
      email: l.email || null,
      phone: l.phone || null,
      company: l.company || null,
      position: l.position || null,
      website: l.website || null,
      niche: l.niche || null,
      city: l.city || null,
      region: l.region || null,
      country: l.country || null,
      timezone: l.timezone || 'UTC',
      status: targetStatus,
      assigned_to: targetAssignedTo,
      assignedTo: targetAssignedTo,
      userId: targetAssignedTo,
      priority: parseInt(l.priority) || 0,
      list: l.list || '',
      source: l.source || 'csv_import',
      suppression: l.suppression || { email: false, phone: false, sms: false, whatsapp: false, dnc: false },
      coldOutreachStopped: Boolean(l.coldOutreachStopped),
      contact: {
        name: l.name || 'N/A',
        email: l.email || '',
        phone: l.phone || '',
        position: l.position || '',
        preferredChannel: ''
      },

      companyObj: {
        name: l.company || '',
        website: l.website || '',
        niche: l.niche || ''
      },
      geography: {
        city: l.city || '',
        region: l.region || '',
        country: l.country || '',
        timezone: l.timezone || 'UTC'
      },
      assignment: {
        list: l.list || '',
        priority: parseInt(l.priority) || 0
      },
      created_at: now
    }));

    // Round-Robin Distribution
    if (isRoundRobin) {
      try {
        const allUsers = await UserStore.findAllUsers();
        const activeRepIds = allUsers
          .filter(u => u.role === 'salesperson' && u.approved && u.active !== false)
          .map(u => String(u._id || u.id));

        if (activeRepIds.length > 0) {
          dbRows = distributeLeadsRoundRobin(dbRows, activeRepIds);
        }
      } catch (rrErr) {
        console.warn('[Round-Robin CSV Distribution Notice]:', rrErr.message);
      }
    }

    const insertedResult = await LeadStore.createBulk(dbRows);
    insertedCount = Array.isArray(insertedResult) ? insertedResult.length : dbRows.length;
    summary.imported = insertedCount;

    // Background sync to Listmonk
    try {
      for (const lead of dbRows) {
        if (lead.email) {
          syncLeadToListmonk(lead).catch(() => {});
        }
      }
    } catch (syncErr) {}
  }

  return {
    success: true,
    message: `Successfully imported ${insertedCount} leads (${summary.duplicates} duplicates skipped, ${summary.invalid} invalid rows skipped).`,
    summary: {
      ...summary,
      imported: insertedCount
    },
    headerSummary,
    columnMap,
    duplicateList: duplicateRecords.slice(0, 20),
    invalidList: invalidRecords.slice(0, 20)
  };
}
