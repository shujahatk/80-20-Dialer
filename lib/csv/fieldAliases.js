/**
 * Centralized CSV Field Alias & Canonical Mapping Configuration
 */

export const FIELD_ALIASES = {
  name: [
    'name',
    'full_name',
    'fullname',
    'contact_name',
    'contact',
    'person',
    'prospect_name',
    'lead_name',
    'customer_name',
    'client_name',
    'contactname',
    'leadname'
  ],
  first_name: [
    'first_name',
    'firstname',
    'first',
    'given_name',
    'givenname',
    'fname'
  ],
  last_name: [
    'last_name',
    'lastname',
    'surname',
    'family_name',
    'familyname',
    'lname'
  ],
  email: [
    'email',
    'email_address',
    'emailaddress',
    'e_mail',
    'e-mail',
    'business_email',
    'work_email',
    'contact_email',
    'mail',
    'primary_email'
  ],
  phone: [
    'phone',
    'phone_number',
    'phonenumber',
    'mobile',
    'mobile_number',
    'cell',
    'cellphone',
    'telephone',
    'tel',
    'contact_number',
    'contact_phone',
    'business_phone',
    'work_phone',
    'phone_1',
    'mobile_phone'
  ],
  company: [
    'company',
    'company_name',
    'companyname',
    'organization',
    'organisation',
    'org',
    'business',
    'business_name',
    'employer',
    'account_name',
    'account'
  ],
  position: [
    'position',
    'job_title',
    'jobtitle',
    'title',
    'designation',
    'role',
    'occupation',
    'profession'
  ],
  website: [
    'website',
    'company_website',
    'companywebsite',
    'domain',
    'url',
    'web',
    'site',
    'homepage'
  ],
  niche: [
    'niche',
    'industry',
    'sector',
    'category',
    'business_type',
    'vertical',
    'market'
  ],
  city: [
    'city',
    'town',
    'locality',
    'municipality'
  ],
  region: [
    'region',
    'state',
    'province',
    'county',
    'territory'
  ],
  country: [
    'country',
    'country_name',
    'nation',
    'country_code'
  ],
  timezone: [
    'timezone',
    'time_zone',
    'tz'
  ],
  priority: [
    'priority',
    'rank',
    'score',
    'lead_score',
    'importance'
  ],
  list: [
    'list',
    'list_name',
    'campaign',
    'source_list',
    'lead_list',
    'group'
  ],
  source: [
    'source',
    'lead_source',
    'origin',
    'provider',
    'platform'
  ]
};

export const TARGET_FIELDS = [
  { id: 'name', label: 'Full Name', description: 'Contact full name' },
  { id: 'first_name', label: 'First Name', description: 'Contact first name' },
  { id: 'last_name', label: 'Last Name', description: 'Contact last name' },
  { id: 'email', label: 'Email Address', description: 'Primary contact email' },
  { id: 'phone', label: 'Phone Number', description: 'Primary mobile/direct phone' },
  { id: 'company', label: 'Company Name', description: 'Organization/Company name' },
  { id: 'position', label: 'Job Title / Position', description: 'Job designation/role' },
  { id: 'website', label: 'Company Website', description: 'Website URL' },
  { id: 'niche', label: 'Industry / Niche', description: 'Market vertical or industry' },
  { id: 'city', label: 'City', description: 'City/Town' },
  { id: 'region', label: 'State / Region', description: 'State or province' },
  { id: 'country', label: 'Country', description: 'Country of location' },
  { id: 'timezone', label: 'Timezone', description: 'Timezone identifier (e.g. America/New_York)' },
  { id: 'priority', label: 'Priority Score', description: 'Numerical ranking priority' },
  { id: 'list', label: 'Lead List', description: 'List or batch name' },
  { id: 'source', label: 'Lead Source', description: 'Acquisition channel or vendor' }
];
