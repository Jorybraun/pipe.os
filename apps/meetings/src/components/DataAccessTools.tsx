import { useFrontendTool } from '@copilotkit/react-core/v2';
import { z } from 'zod';

// API client
const API_BASE = import.meta.env.VITE_MEETINGS_API_URL || 'http://localhost:8788';

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export function DataAccessTools() {
  // Tool: Query contacts
  useFrontendTool({
    name: 'query_contacts',
    description: 'Search and filter contacts from the database. Use this to find people for prospecting.',
    parameters: z.object({
      search: z.string().optional().describe('Search term to filter contacts by name, email, company, or title'),
      type: z.string().optional().describe('Filter by contact type (PROSPECT, CANDIDATE, HIRING_MANAGER, RECRUITER, OTHER)'),
      limit: z.number().optional().describe('Maximum number of results to return (default: 50)'),
    }),
    handler: async ({ search, type, limit = 50 }) => {
      try {
        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (type) params.append('type', type);
        params.append('limit', limit.toString());

        const data = await fetchWithAuth(`/api/v1/contacts?${params.toString()}`);
        return {
          success: true,
          contacts: data.contacts || [],
          total: data.total || 0,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to query contacts',
        };
      }
    },
  });

  // Tool: Query meetings
  useFrontendTool({
    name: 'query_meetings',
    description: 'Search and filter meetings from the database. Use this to understand meeting history and patterns.',
    parameters: z.object({
      status: z.string().optional().describe('Filter by meeting status (SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED)'),
      meeting_type: z.string().optional().describe('Filter by meeting type (DISCOVERY, INTERVIEW, FOLLOW_UP, DEMO, OTHER)'),
      limit: z.number().optional().describe('Maximum number of results to return (default: 50)'),
    }),
    handler: async ({ status, meeting_type, limit = 50 }) => {
      try {
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        if (meeting_type) params.append('meeting_type', meeting_type);
        params.append('limit', limit.toString());

        const data = await fetchWithAuth(`/api/v1/meetings?${params.toString()}`);
        return {
          success: true,
          meetings: data.meetings || [],
          total: data.total || 0,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to query meetings',
        };
      }
    },
  });

  // Tool: Get contact details
  useFrontendTool({
    name: 'get_contact',
    description: 'Get detailed information about a specific contact by ID',
    parameters: z.object({
      id: z.string().describe('The contact ID to retrieve'),
    }),
    handler: async ({ id }) => {
      try {
        const data = await fetchWithAuth(`/api/v1/contacts/${id}`);
        return {
          success: true,
          contact: data,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get contact',
        };
      }
    },
  });

  // Tool: Get meeting details
  useFrontendTool({
    name: 'get_meeting',
    description: 'Get detailed information about a specific meeting by ID',
    parameters: z.object({
      id: z.string().describe('The meeting ID to retrieve'),
    }),
    handler: async ({ id }) => {
      try {
        const data = await fetchWithAuth(`/api/v1/meetings/${id}`);
        return {
          success: true,
          meeting: data,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get meeting',
        };
      }
    },
  });

  return null;
}
