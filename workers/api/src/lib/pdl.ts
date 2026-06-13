/**
 * People Data Labs (PDL) client — candidate sourcing and enrichment.
 *
 * Uses the Person Search API (SQL queries) and Person Enrichment API.
 * Auth: X-Api-Key header.
 *
 * Docs: https://docs.peopledatalabs.com/docs/person-search-api
 */

const PDL_BASE_URL = 'https://api.peopledatalabs.com/v5';

export interface PdlSearchFilters {
  jobTitleRole?: string;
  jobTitleLevel?: string;
  jobCompanyName?: string;
  locationCountry?: string;
  locationRegion?: string;
  skills?: string[];
  hasPhone?: boolean;
  hasEmail?: boolean;
  size?: number;
}

export interface PdlPerson {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  job_title_role: string | null;
  job_title_levels: string[] | null;
  job_company_name: string | null;
  job_company_website: string | null;
  location_name: string | null;
  location_country: string | null;
  emails: Array<{ address: string; type: string }> | null;
  phone_numbers: Array<{ number: string; type: string }> | null;
  linkedin_url: string | null;
  github_url: string | null;
  skills: string[] | null;
  industry: string | null;
  experience: Array<{
    company_name: string | null;
    title: string | null;
    start_date: string | null;
    end_date: string | null;
  }> | null;
  education: Array<{
    school_name: string | null;
    degree: string | null;
    start_date: string | null;
    end_date: string | null;
  }> | null;
}

export interface PdlSearchResponse {
  status: number;
  data: PdlPerson[];
  total: number;
  scroll_token?: string;
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function buildSearchSql(filters: PdlSearchFilters): string {
  const conditions: string[] = [];

  if (filters.jobTitleRole) {
    conditions.push(`job_title_role = '${escapeSql(filters.jobTitleRole)}'`);
  }
  if (filters.jobTitleLevel) {
    conditions.push(`job_title_levels = '${escapeSql(filters.jobTitleLevel)}'`);
  }
  if (filters.jobCompanyName) {
    conditions.push(`job_company_name = '${escapeSql(filters.jobCompanyName)}'`);
  }
  if (filters.locationCountry) {
    conditions.push(`location_country = '${escapeSql(filters.locationCountry)}'`);
  }
  if (filters.locationRegion) {
    conditions.push(`location_region = '${escapeSql(filters.locationRegion)}'`);
  }
  if (filters.skills && filters.skills.length > 0) {
    const skillList = filters.skills.map((s) => `'${escapeSql(s)}'`).join(', ');
    conditions.push(`skills IN (${skillList})`);
  }
  if (filters.hasPhone) {
    conditions.push('phone_numbers IS NOT NULL');
  }
  if (filters.hasEmail) {
    conditions.push('emails IS NOT NULL');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return `SELECT * FROM person ${whereClause}`;
}

export async function searchPeople(
  apiKey: string,
  filters: PdlSearchFilters,
): Promise<PdlSearchResponse> {
  const sql = buildSearchSql(filters);
  const size = filters.size ?? 10;

  const response = await fetch(`${PDL_BASE_URL}/person/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({ sql, size }),
  });

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const message =
      typeof body.error === 'string'
        ? body.error
        : typeof (body.error as Record<string, unknown>)?.message === 'string'
          ? (body.error as Record<string, unknown>).message
          : `PDL search failed (${response.status})`;
    throw new Error(message);
  }

  return {
    status: typeof body.status === 'number' ? body.status : response.status,
    data: Array.isArray(body.data) ? (body.data as PdlPerson[]) : [],
    total: typeof body.total === 'number' ? body.total : 0,
    scroll_token: typeof body.scroll_token === 'string' ? body.scroll_token : undefined,
  };
}

export async function enrichPerson(
  apiKey: string,
  params: { email?: string; name?: string; company?: string; domain?: string },
): Promise<PdlPerson | null> {
  const query: Record<string, string> = {};
  if (params.email) query.email = params.email;
  if (params.name) query.name = params.name;
  if (params.company) query.company = params.company;
  if (params.domain) query.domain = params.domain;

  const url = new URL(`${PDL_BASE_URL}/person/enrich`);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'X-Api-Key': apiKey },
  });

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    return null;
  }

  const data = body.data as PdlPerson | undefined;
  return data ?? null;
}
