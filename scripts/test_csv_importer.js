
if (process.env.ALLOW_LEGACY_INTEGRATION_TESTS !== '1' || !process.env.TEST_SUPABASE_URL || !process.env.TEST_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Legacy integration scripts mutate records and may send messages. Use an isolated test Supabase project with TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY, and ALLOW_LEGACY_INTEGRATION_TESTS=1. npm test runs isolated regression tests.');
}
process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
import { processCsvUpload } from '../lib/csv/importLeads.js';
import { normalizeHeader } from '../lib/csv/normalizeHeader.js';
import { normalizeEmail, normalizePhone, constructName, sanitizeCsvValue } from '../lib/csv/normalizeLead.js';
import { detectDelimiter } from '../lib/csv/parseCsv.js';
import { LeadStore } from '../lib/store.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${testName} ${details ? '- ' + details : ''}`);
  }
}

async function runCsvImporterTests() {
  console.log('\n===============================================================');
  console.log('📥  80/20 OUTBOUND SYSTEM — UNIVERSAL CSV IMPORTER TEST SUITE');
  console.log('===============================================================\n');

  console.log('--- TEST GROUP 1: HEADER & VALUE NORMALIZATION ---');

  // 1. Header normalization
  assert(normalizeHeader('First Name') === 'first_name', 'Normalizes spaces to underscore');
  assert(normalizeHeader('first-name') === 'first_name', 'Normalizes hyphens to underscore');
  assert(normalizeHeader('FIRST_NAME') === 'first_name', 'Normalizes uppercase');
  assert(normalizeHeader(' first name ') === 'first_name', 'Trims whitespace');
  assert(normalizeHeader('\uFEFFContact Name') === 'contact_name', 'Strips UTF-8 BOM');
  assert(normalizeHeader('emailAddress') === 'email_address', 'Handles camelCase to snake_case');
  assert(normalizeHeader('Company (HQ)...') === 'company_hq', 'Strips unwanted punctuation');

  // 2. Email normalization
  assert(normalizeEmail('  JOHN@EXAMPLE.COM ') === 'john@example.com', 'Normalizes email casing and whitespace');
  assert(normalizeEmail('john.doe+filter@domain.co.uk') === 'john.doe+filter@domain.co.uk', 'Preserves valid email plus signs and domain');
  assert(normalizeEmail('not-an-email') === null, 'Rejects invalid email format');
  assert(normalizeEmail('N/A') === null, 'Rejects N/A dirty value');

  // 3. Phone normalization
  assert(normalizePhone('+1 (555) 123-4567') === '+15551234567', 'Preserves international + and strips brackets/dashes');
  assert(normalizePhone('0312-1234567') === '03121234567', 'Normalizes standard local phone');
  assert(normalizePhone('+44 20 1234 5678') === '+442012345678', 'Normalizes UK format');
  assert(normalizePhone('123') === null, 'Rejects unusable short phone');

  // 4. Name construction
  assert(constructName('John Doe', 'John', 'Doe') === 'John Doe', 'Uses full_name when provided');
  assert(constructName('', 'Alice', 'Smith') === 'Alice Smith', 'Combines first_name and last_name when full_name missing');
  assert(constructName(null, 'Bob', '') === 'Bob', 'Handles single first_name without undefined or null');
  assert(constructName('N/A', 'Carol', null) === 'Carol', 'Handles N/A placeholder');

  // 5. Formula Injection Sanitization
  assert(sanitizeCsvValue('=cmd|calc!A0').startsWith("'="), 'Neutralizes dangerous spreadsheet formula prefix');
  assert(sanitizeCsvValue('+15551234567') === '+15551234567', 'Preserves valid international phone numbers starting with +');

  console.log('\n--- TEST GROUP 2: DELIMITER AUTODETECTION ---');
  assert(detectDelimiter('name,email,phone') === ',', 'Detects comma delimiter');
  assert(detectDelimiter('name;email;phone') === ';', 'Detects semicolon delimiter');
  assert(detectDelimiter('name\temail\tphone') === '\t', 'Detects tab delimiter');

  console.log('\n--- TEST GROUP 3: STRUCTURALLY DIVERSE CSV FORMATS ---');

  // Clean up any test leads from previous runs to ensure clean deduplication tests
  const testEmails = [
    'john.a@test.com',
    'jane.b@test.com',
    'robert.c@test.com',
    'david.d@test.com',
    'emma.e@test.com',
    'frank.f@test.com',
    'golf.g@test.com',
    'valid1@mix.com',
    'valid3@mix.com',
    'preview@test.com'
  ];

  for (const email of testEmails) {
    const existing = await LeadStore.findPendingByEmail(email);
    for (const lead of existing) {
      await LeadStore.purgePermanent(lead._id || lead.id);
    }
  }

  // Format A: Standard Name,Email,Phone,Company
  const csvA = `Name,Email,Phone,Company
John A,john.a@test.com,+15550000001,Acme A`;
  const resA = await processCsvUpload({ csvBufferOrString: csvA, assignToUserId: 'pool' });
  assert(resA.success && resA.summary.imported === 1, 'CSV A: Standard format imports successfully');


  // Format B: Full Name,Email Address,Mobile Number,Company Name
  const csvB = `Full Name,Email Address,Mobile Number,Company Name
Jane B,jane.b@test.com,+15550000002,Beta Solutions`;
  const resB = await processCsvUpload({ csvBufferOrString: csvB, assignToUserId: 'pool' });
  assert(resB.success && resB.summary.imported === 1, 'CSV B: Full Name & Mobile Number aliases import correctly');

  // Format C: first_name,last_name,business_email,telephone,organization
  const csvC = `first_name,last_name,business_email,telephone,organization
Robert,C,robert.c@test.com,+15550000003,Charlie Corp`;
  const resC = await processCsvUpload({ csvBufferOrString: csvC, assignToUserId: 'pool' });
  assert(resC.success && resC.summary.imported === 1, 'CSV C: Split first/last name & telephone alias import correctly');

  // Format D: Extra / unknown columns (linkedin_url, apollo_id, random_field)
  const csvD = `random_field,email_address,industry,company_name,mobile,linkedin_url,apollo_id
xyz-99,david.d@test.com,Software,Delta LLC,+15550000004,https://linkedin.com/in/dd,ap_1234`;
  const resD = await processCsvUpload({ csvBufferOrString: csvD, assignToUserId: 'pool' });
  assert(resD.success && resD.summary.imported === 1, 'CSV D: Safely ignores unknown columns without error');

  // Format E: Uppercase headers & reverse column order
  const csvE = `EMAIL,COMPANY,PHONE,NAME
emma.e@test.com,Echo Enterprises,+15550000005,Emma E`;
  const resE = await processCsvUpload({ csvBufferOrString: csvE, assignToUserId: 'pool' });
  assert(resE.success && resE.summary.imported === 1, 'CSV E: Handles uppercase headers and reverse column order');

  // Format F: Work Email,First Name,Last Name,Business,Job Title,Country
  const csvF = `Work Email,First Name,Last Name,Business,Job Title,Country
frank.f@test.com,Frank,F,Foxtrot Inc,VP Sales,United States`;
  const resF = await processCsvUpload({ csvBufferOrString: csvF, assignToUserId: 'pool' });
  assert(resF.success && resF.summary.imported === 1, 'CSV F: Maps Job Title, Country, and Business successfully');

  // Format G: Semicolon Delimited CSV
  const csvG = `Company Name;Email Address;Mobile Number;Contact Name
Golf Co;golf.g@test.com;+15550000007;George G`;
  const resG = await processCsvUpload({ csvBufferOrString: csvG, assignToUserId: 'pool' });
  assert(resG.success && resG.summary.imported === 1, 'CSV G: Semicolon delimited file auto-detected and imported');

  console.log('\n--- TEST GROUP 4: ROW VALIDATION & DUPLICATE SAFETY ---');

  for (const email of ['valid1@mix.com', 'valid3@mix.com', 'preview@test.com']) {
    const existing = await LeadStore.findPendingByEmail(email);
    for (const lead of existing) {
      await LeadStore.purgePermanent(lead._id || lead.id);
    }
  }
  for (const phone of ['+15551111111', '+15552222222', '+15558888888', '+15559999999', '15551111111', '15552222222']) {
    const existing = await LeadStore.findPendingByPhone(phone);
    for (const lead of existing) {
      await LeadStore.purgePermanent(lead._id || lead.id);
    }
  }

  // Test row-level validation: missing both email and phone should skip that row only
  const mixedCsv = `Full Name,Email,Phone,Company
Valid 1,valid1@mix.com,+15551111111,Mix Co
Invalid Row,N/A,unknown,No Contact Co
Valid 2 Phone Only,NULL,+15552222222,Phone Only Co
Valid 3 Email Only,valid3@mix.com,N/A,Email Only Co`;
  const resMixed = await processCsvUpload({ csvBufferOrString: mixedCsv, assignToUserId: 'pool' });
  assert(resMixed.summary.totalRows === 4, 'Mixed CSV: Total 4 rows processed');
  assert(resMixed.summary.imported === 3, 'Mixed CSV: 3 valid rows imported');
  assert(resMixed.summary.invalid === 1, 'Mixed CSV: Exactly 1 row skipped due to missing contact info');


  // Test Deduplication: repeat of existing email should be skipped
  const duplicateCsv = `Name,Email,Phone,Company
Duplicate Alpha,valid1@mix.com,+15559999999,Existing Company`;
  const resDup = await processCsvUpload({ csvBufferOrString: duplicateCsv, assignToUserId: 'pool', duplicateStrategy: 'skip' });
  assert(resDup.summary.duplicates === 1, 'Deduplication: Identifies existing email and skips duplicate');
  assert(resDup.summary.imported === 0, 'Deduplication: 0 duplicates inserted');

  // Test Preview Mode: does not write to DB
  const previewCsv = `Name,Email,Phone,Company
Preview Lead,preview@test.com,+15558888888,Preview Corp`;
  const resPreview = await processCsvUpload({ csvBufferOrString: previewCsv, previewOnly: true });
  assert(resPreview.preview === true, 'Preview Mode: Flagged as preview');
  assert(resPreview.summary.validRows === 1, 'Preview Mode: Calculates valid row count');
  assert(resPreview.headerSummary.length > 0, 'Preview Mode: Generates header mapping summary');
  const checkDb = await LeadStore.findPendingByEmail('preview@test.com');
  assert(checkDb.length === 0, 'Preview Mode: Does not write preview lead to database');

  console.log('\n===============================================================');
  console.log(`📊 TEST SUMMARY: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
  console.log('===============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runCsvImporterTests().catch(err => {
  console.error('Fatal CSV test error:', err);
  process.exit(1);
});
