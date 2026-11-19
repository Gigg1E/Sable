import type { McpServerConfig } from './types';

export interface ConnectorPreset {
  id: string;
  name: string;
  vendor: string;
  description: string;
  /** one-click: OAuth with dynamic registration. client: OAuth with your own client ID. token: paste a token. local: runs on the server. */
  setup: 'one-click' | 'client' | 'token' | 'local';
  badge?: string;
  config: Omit<McpServerConfig, 'id' | 'enabled'>;
  help?: string;
  docs?: string;
}

/**
 * Curated connectors. Official remote MCP servers use OAuth, so most are "Connect account".
 * Google requires every self-hosted app to bring its own OAuth client (one-time setup).
 */
export const CONNECTOR_PRESETS: ConnectorPreset[] = [
  {
    id: 'notion',
    name: 'Notion',
    vendor: 'Official · Notion',
    description: 'Search, read and update pages and databases.',
    setup: 'one-click',
    config: { name: 'Notion', transport: 'http', url: 'https://mcp.notion.com/mcp', auth: 'oauth', preset: 'notion' },
    docs: 'https://developers.notion.com/docs/mcp',
  },
  {
    id: 'linear',
    name: 'Linear',
    vendor: 'Official · Linear',
    description: 'Find, create and update issues and projects.',
    setup: 'one-click',
    config: { name: 'Linear', transport: 'http', url: 'https://mcp.linear.app/mcp', auth: 'oauth', preset: 'linear' },
    docs: 'https://linear.app/docs/mcp',
  },
  {
    id: 'microsoft-365',
    name: 'Outlook & Microsoft 365',
    vendor: 'Open source · Softeria',
    description: 'Outlook mail, calendar, contacts, OneDrive and To Do via Microsoft Graph. Personal and work accounts.',
    setup: 'local',
    config: { name: 'Microsoft 365', transport: 'stdio', command: 'npx', args: ['-y', '@softeria/ms-365-mcp-server'], env: {}, preset: 'microsoft-365' },
    help: 'Runs on your server. After adding it, ask Sable to “log in to Microsoft 365”: you get a code to enter at microsoft.com/devicelogin.',
    docs: 'https://github.com/Softeria/ms-365-mcp-server',
  },
  {
    id: 'github',
    name: 'GitHub',
    vendor: 'Official · GitHub',
    description: 'Repositories, issues, pull requests and Actions.',
    setup: 'token',
    config: { name: 'GitHub', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', auth: 'headers', headers: { Authorization: 'Bearer ' }, preset: 'github' },
    help: 'Paste a fine-grained personal access token after “Bearer ”.',
    docs: 'https://github.com/github/github-mcp-server',
  },
];
