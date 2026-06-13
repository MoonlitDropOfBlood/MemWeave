import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MemweaveClient } from './client.js';
import { registerTools, type McpTool } from './registry.js';
import { saveTool } from './tools/save.js';
import { recallTool } from './tools/recall.js';
import { smartSearchTool } from './tools/smart-search.js';
import { expandTool } from './tools/expand.js';
import { graphQueryTool } from './tools/graph-query.js';
import { fileHistoryTool } from './tools/file-history.js';
import { sessionsTool } from './tools/sessions.js';
import { patternsTool } from './tools/patterns.js';
import { consolidateTool } from './tools/consolidate.js';
import { forgetTool } from './tools/forget.js';

const BASE_URL = process.env.MEMWEAVE_URL || 'http://127.0.0.1:3131';
const client = new MemweaveClient({ baseUrl: BASE_URL });
const server = new McpServer({ name: 'memweave-mcp', version: '0.1.0' });

const tools: McpTool[] = [
  saveTool,
  recallTool,
  smartSearchTool,
  expandTool,
  graphQueryTool,
  fileHistoryTool,
  sessionsTool,
  patternsTool,
  consolidateTool,
  forgetTool
];

registerTools(server, client, tools);

const transport = new StdioServerTransport();

try {
  await server.connect(transport);
  console.error('memweave-mcp connected');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`memweave-mcp failed to connect: ${message}`);
  process.exit(1);
}

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.close();
  process.exit(0);
});
