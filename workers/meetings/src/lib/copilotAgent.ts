/**
 * Custom AI Agent for Meetings App
 * Implements CopilotKit-compatible interface but uses Cloudflare AI directly
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CopilotInput {
  ai: Ai;
  history: LLMMessage[];
  userMessage: string;
  toolCtx: ToolExecContext;
}

export interface CopilotOutput {
  response: string;
  toolsUsed: string[];
  updatedHistory: LLMMessage[];
  // CopilotKit AGUI actions
  actions?: Array<{
    type: 'navigate' | 'render';
    path?: string;
    component?: string;
    props?: any;
  }>;
}

export interface ToolExecContext {
  db: D1Database;
}

// Available tools for the agent
const tools = [
  {
    name: 'navigate',
    description: 'Navigate to a different page in the app',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          enum: ['/contacts', '/meetings', '/settings'],
          description: 'The path to navigate to'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'getContacts',
    description: 'Get a list of contacts from the database',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of contacts to return',
          default: 5
        }
      }
    }
  },
  {
    name: 'getMeetings',
    description: 'Get a list of meetings from the database',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
];

export async function runCopilotTurn(input: CopilotInput): Promise<CopilotOutput> {
  const { ai, history, userMessage, toolCtx } = input;
  
  // Get current app state context
  const appContext = `Current app state: 
- User is on a meetings and contacts application
- Available pages: /contacts, /meetings, /settings
- Database has contacts and meetings tables
- You can navigate between pages and render data cards

Your task: Understand what the user wants and break it down into steps:
1. What information do they need?
2. Which page should they be on?
3. What data should you show them?

Available actions:
- navigate(path): Move to /contacts, /meetings, or /settings
- render(component, props): Show a MeetingCard or ContactCard with data
- getContacts(): Fetch contacts from database
- getMeetings(): Fetch meetings from database

Think step by step and return your reasoning, then take the appropriate actions.`;

  const messages: LLMMessage[] = [
    { role: 'system', content: appContext },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const response = await ai.run('@cf/google/gemma-4-26b-a4b-it', {
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  });

  console.log('AI response:', JSON.stringify(response, null, 2));
  
  let content = response?.choices?.[0]?.message?.content || String(response || '');
  
  // Clean up any tool call syntax
  content = content.replace(/<\|tool_call\|>.*?<tool_call\|>/g, '').trim();
  
  // Parse the AI's response to determine actions
  const lowerContent = content.toLowerCase();
  let actions: Array<{ type: 'navigate' | 'render'; path?: string; component?: string; props?: any }> = [];
  let toolUsed: string | null = null;

  // AI-driven action detection based on its reasoning
  if (lowerContent.includes('meeting') || lowerContent.includes('schedule') || lowerContent.includes('calendar')) {
    toolUsed = 'getMeetings';
    actions.push({ type: 'navigate', path: '/meetings' });
    
    // If AI mentions showing data, fetch and render
    if (lowerContent.includes('show') || lowerContent.includes('display') || lowerContent.includes('here')) {
      const meetings = await executeGetMeetings(toolCtx.db);
      const meetingData = JSON.parse(meetings || '{}').meetings || [];
      if (meetingData.length > 0) {
        actions.push({
          type: 'render',
          component: 'MeetingCard',
          props: meetingData[0]
        });
      }
    }
  }
  
  if (lowerContent.includes('contact') || lowerContent.includes('prospect') || lowerContent.includes('person')) {
    toolUsed = 'getContacts';
    actions.push({ type: 'navigate', path: '/contacts' });
    
    // If AI mentions showing data, fetch and render
    if (lowerContent.includes('show') || lowerContent.includes('display') || lowerContent.includes('here')) {
      const contacts = await executeGetContacts(toolCtx.db, 5);
      const contactData = JSON.parse(contacts || '{}').contacts || [];
      if (contactData.length > 0) {
        actions.push({
          type: 'render',
          component: 'ContactCard',
          props: contactData[0]
        });
      }
    }
  }

  const updatedHistory: LLMMessage[] = [
    ...history,
    { role: 'user', content: userMessage },
    { role: 'assistant', content },
  ];

  return {
    response: content,
    toolsUsed: toolUsed ? [toolUsed] : [],
    updatedHistory,
    actions: actions.length > 0 ? actions : undefined,
  };
}

async function executeGetMeetings(db: D1Database): Promise<string> {
  try {
    const meetings = await db.prepare('SELECT * FROM meetings ORDER BY scheduled_at ASC LIMIT 10').all();
    return JSON.stringify({ meetings: meetings.results || [] }, null, 2);
  } catch (error) {
    console.error('Error fetching meetings:', error);
    return JSON.stringify({ error: 'Failed to fetch meetings' });
  }
}

async function executeGetContacts(db: D1Database, limit: number = 5): Promise<string> {
  try {
    const contacts = await db.prepare('SELECT * FROM contacts LIMIT ?').bind(limit).all();
    return JSON.stringify({ contacts: contacts.results || [] }, null, 2);
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return JSON.stringify({ error: 'Failed to fetch contacts' });
  }
}
