import { NextResponse } from 'next/server.js';
import { requireManager } from '../../../../lib/middleware/authGuard.js';
import { processCsvUpload } from '../../../../lib/csv/importLeads.js';

export async function POST(req) {
  try {
    const { user, errorResponse } = await requireManager(req);
    if (errorResponse) return errorResponse;

    const contentType = req.headers.get('content-type') || '';
    let csvBufferOrString = null;
    let assignToUserId = 'pool';
    let manualOverrides = {};
    let duplicateStrategy = 'skip';
    let previewOnly = false;
    let defaultList = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file');
      assignToUserId = formData.get('assignToUserId') || formData.get('userId') || 'pool';
      duplicateStrategy = formData.get('duplicateStrategy') || 'skip';
      previewOnly = formData.get('preview') === 'true' || formData.get('previewOnly') === 'true';
      defaultList = formData.get('defaultList') || '';

      const rawOverrides = formData.get('manualOverrides');
      if (rawOverrides) {
        try {
          manualOverrides = typeof rawOverrides === 'string' ? JSON.parse(rawOverrides) : rawOverrides;
        } catch (e) {}
      }

      if (!file) {
        return NextResponse.json(
          { success: false, message: 'No CSV file uploaded.' },
          { status: 400 }
        );
      }

      const MAX_SIZE = 15 * 1024 * 1024;
      if (file.size && file.size > MAX_SIZE) {
        return NextResponse.json(
          { success: false, message: 'File exceeds maximum upload size limit of 15MB.' },
          { status: 413 }
        );
      }

      csvBufferOrString = Buffer.from(await file.arrayBuffer());
    } else {
      const body = await req.json().catch(() => ({}));
      csvBufferOrString = body.csvText || body.csvContent || '';
      assignToUserId = body.assignToUserId || body.userId || 'pool';
      manualOverrides = body.manualOverrides || {};
      duplicateStrategy = body.duplicateStrategy || 'skip';
      previewOnly = body.preview === true || body.previewOnly === true;
      defaultList = body.defaultList || '';
    }

    if (!csvBufferOrString || csvBufferOrString.length === 0) {
      return NextResponse.json(
        { success: false, message: 'No readable CSV content provided.' },
        { status: 400 }
      );
    }

    const result = await processCsvUpload({
      csvBufferOrString,
      assignToUserId,
      manualOverrides,
      duplicateStrategy,
      previewOnly,
      defaultList
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message || 'Failed to process CSV file.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      data: {
        total: result.summary.totalRows,
        importedCount: result.summary.imported,
        skippedCount: result.summary.skipped,
        duplicates: result.summary.duplicates,
        invalid: result.summary.invalid,
        summary: result.summary,
        headerSummary: result.headerSummary,
        columnMap: result.columnMap,
        sampleRows: result.sampleRows || [],
        duplicateList: result.duplicateList || [],
        invalidList: result.invalidList || [],
        preview: result.preview || false,
        assignedTo: assignToUserId,
        destination: assignToUserId === 'round_robin'
          ? 'Round-Robin Distribution'
          : assignToUserId === 'pool'
          ? 'Unassigned Global Pool'
          : 'Salesperson Queue'
      }
    });
  } catch (err) {
    console.error('[CSV Upload Processing Error]:', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred during CSV import.' },
      { status: 500 }
    );
  }
}
