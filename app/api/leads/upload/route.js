import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { LeadStore } from '@/lib/store';
import csv from 'csv-parser';
import { Readable } from 'stream';

const CSV_COLUMN_MAP = {
  name: ['name', 'full_name', 'fullname', 'contact_name', 'contactname'],
  phone: ['phone', 'phone_number', 'phonenumber', 'mobile', 'cell', 'telephone'],
  email: ['email', 'email_address', 'emailaddress', 'e-mail'],
  position: ['position', 'title', 'job_title', 'jobtitle', 'role'],
  company_name: ['company', 'company_name', 'companyname', 'organization', 'org'],
  company_website: ['website', 'company_website', 'companywebsite', 'url'],
  niche: ['niche', 'industry', 'sector', 'category'],
  country: ['country', 'country_code'],
  city: ['city', 'town'],
  region: ['region', 'state', 'province', 'area'],
  timezone: ['timezone', 'tz'],
  list: ['list', 'list_name', 'listname', 'source'],
  priority: ['priority', 'rank', 'score']
};

function mapCsvHeaders(headers) {
  const mapped = {};
  const lowerHeaders = headers.map(h => h.toLowerCase().trim().replace(/[\s-]+/g, '_'));
  for (const [field, aliases] of Object.entries(CSV_COLUMN_MAP)) {
    const idx = lowerHeaders.findIndex(h => aliases.includes(h));
    if (idx !== -1) mapped[field] = headers[idx];
  }
  return mapped;
}

export async function POST(req) {
  try {
    const user = await verifyAuth(req);
    if (!user || !['owner', 'manager', 'admin'].includes(user.role)) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized. Manager privileges required.' },
        { status: 401 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const campaignId = formData.get('campaignId') || null;
    const assignTo = formData.get('userId') || null;

    if (!file) {
      return NextResponse.json(
        { success: false, message: 'No CSV file provided.' },
        { status: 400 }
      );
    }

    const results = [];
    const duplicates = [];
    const errors = [];

    const buffer = Buffer.from(await file.arrayBuffer());
    const stream = Readable.from(buffer.toString());

    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (row) => results.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    const headers = results.length > 0 ? Object.keys(results[0]) : [];
    const columnMap = mapCsvHeaders(headers);

    for (let i = 0; i < results.length; i++) {
      const row = results[i];
      
      const leadData = {
        contact: {
          name: row[columnMap.name] || '',
          position: row[columnMap.position] || '',
          phone: row[columnMap.phone] || '',
          email: row[columnMap.email] || '',
          preferredChannel: ''
        },
        company: {
          name: row[columnMap.company_name] || '',
          website: row[columnMap.company_website] || '',
          niche: row[columnMap.niche] || '',
          notes: ''
        },
        geography: {
          country: row[columnMap.country] || '',
          city: row[columnMap.city] || '',
          region: row[columnMap.region] || '',
          timezone: row[columnMap.timezone] || 'UTC'
        },
        assignment: {
          list: row[columnMap.list] || '',
          priority: parseInt(row[columnMap.priority]) || 0,
          dateAssigned: new Date()
        },
        status: 'new',
        nextAction: 'call',
        userId: assignTo,
        campaignId: campaignId
      };

      if (!leadData.contact.name) {
        errors.push({ row: i + 2, reason: 'Missing lead name' });
        continue;
      }

      if (leadData.contact.phone) {
        const existing = await LeadStore.findPendingByPhone(leadData.contact.phone);
        if (existing.length > 0) {
          duplicates.push({ row: i + 2, name: leadData.contact.name, phone: leadData.contact.phone });
          continue;
        }
      }

      if (leadData.contact.email) {
        const existing = await LeadStore.findPendingByEmail(leadData.contact.email);
        if (existing.length > 0) {
          duplicates.push({ row: i + 2, name: leadData.contact.name, email: leadData.contact.email });
          continue;
        }
      }

      await LeadStore.create(leadData);
    }

    return NextResponse.json({
      success: true,
      message: `Import complete. ${results.length - duplicates.length - errors.length} leads imported.`,
      data: {
        total: results.length,
        imported: results.length - duplicates.length - errors.length,
        duplicates: duplicates.length,
        duplicateList: duplicates,
        errors: errors.length,
        errorList: errors
      }
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err.message || 'Server error occurred.' },
      { status: 500 }
    );
  }
}
