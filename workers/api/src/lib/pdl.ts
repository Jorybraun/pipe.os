/**
 * People Data Labs (PDL) client — candidate sourcing and enrichment.
 *
 * Uses the Person Search API (Elasticsearch queries) and Person Enrichment API.
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

function buildSearchQuery(filters: PdlSearchFilters): Record<string, unknown> {
  const must: Record<string, unknown>[] = [];
  const should: Record<string, unknown>[] = [];
  const filter: Record<string, unknown>[] = [];

  if (filters.jobTitleRole) {
    // Match normalized role exactly OR raw title contains all words
    should.push(
      { term: { job_title_role: filters.jobTitleRole } },
      { match: { job_title: { query: filters.jobTitleRole, operator: 'and' } } },
    );
  }
  if (filters.jobTitleLevel) {
    filter.push({ terms: { job_title_levels: [filters.jobTitleLevel] } });
  }
  if (filters.jobCompanyName) {
    filter.push({ term: { job_company_name: filters.jobCompanyName } });
  }
  if (filters.locationCountry) {
    filter.push({ term: { location_country: filters.locationCountry } });
  }
  if (filters.locationRegion) {
    filter.push({ term: { location_region: filters.locationRegion } });
  }
  if (filters.skills && filters.skills.length > 0) {
    filter.push({ terms: { skills: filters.skills } });
  }
  if (filters.hasEmail) {
    filter.push({ exists: { field: 'emails' } });
  }
  if (filters.hasPhone) {
    filter.push({ exists: { field: 'phone_numbers' } });
  }

  // Quality gates — require name and job title
  filter.push({ exists: { field: 'full_name' } });
  filter.push({ exists: { field: 'job_title' } });

  const boolQuery: Record<string, unknown> = {};
  if (should.length > 0) boolQuery.should = should;
  if (must.length > 0) boolQuery.must = must;
  if (filter.length > 0) boolQuery.filter = filter;
  if (should.length > 0) boolQuery.minimum_should_match = 1;

  // If only filters exist, add match_all to satisfy bool query structure
  if (should.length === 0 && must.length === 0 && filter.length > 0) {
    boolQuery.must = { match_all: {} };
  }

  return { query: { bool: boolQuery } };
}

export async function searchPeople(
  apiKey: string,
  filters: PdlSearchFilters,
): Promise<PdlSearchResponse> {
  const esQuery = buildSearchQuery(filters);
  const size = filters.size ?? 10;

  const response = await fetch(`${PDL_BASE_URL}/person/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({ ...esQuery, size }),
  });

  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    let message: string;
    if (typeof body.error === 'string') {
      message = body.error;
    } else {
      const errObj = body.error as Record<string, unknown> | undefined;
      message = typeof errObj?.message === 'string' ? errObj.message : `PDL search failed (${response.status})`;
    }
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
