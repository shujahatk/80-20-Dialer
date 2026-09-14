import csv from 'csv-parser';
import { Readable } from 'stream';

/**
 * Intelligently detects the CSV delimiter from the first few lines of text.
 * Checks for commas, semicolons, tabs, and pipes.
 */
export function detectDelimiter(sampleText) {
  if (!sampleText || typeof sampleText !== 'string') return ',';

  // Take the first line (or first non-empty line)
  const firstLine = sampleText.split(/\r\n|\r|\n/).find(line => line.trim().length > 0) || '';

  const counts = {
    ',': (firstLine.match(/,/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
    '|': (firstLine.match(/\|/g) || []).length
  };

  let maxCount = 0;
  let bestDelimiter = ',';

  for (const [delim, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      bestDelimiter = delim;
    }
  }

  return bestDelimiter;
}

/**
 * Parses raw CSV string or Buffer into an array of row objects and headers.
 */
export async function parseCsvBuffer(bufferOrString, options = {}) {
  let content = typeof bufferOrString === 'string' ? bufferOrString : bufferOrString.toString('utf8');

  // Strip BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  const delimiter = options.delimiter || detectDelimiter(content);

  const rawRows = [];
  const stream = Readable.from(content);

  await new Promise((resolve, reject) => {
    stream
      .pipe(
        csv({
          separator: delimiter,
          trim: true,
          skipEmptyLines: true,
          mapHeaders: ({ header }) => header ? header.trim().replace(/^\uFEFF/, '') : ''
        })
      )
      .on('data', (row) => {
        // Only keep rows that have at least one non-empty value
        const hasValues = Object.values(row).some(v => v !== undefined && v !== null && String(v).trim() !== '');
        if (hasValues) {
          rawRows.push(row);
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  const headers = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];

  return {
    rawRows,
    headers,
    delimiter,
    totalCount: rawRows.length
  };
}
