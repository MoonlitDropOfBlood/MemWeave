/**
 * MemWeave MCP server �?HTTP transport entry.
 *
 * As of v0.4 the MCP server is embedded in the main @mem-weave/server
 * process and exposed at POST/GET/DELETE /mcp via the Web Standard
 * Streamable HTTP transport.
 *
 * The SDK ships both a Node-friendly (via @hono/node-server) and a
 * Web Standard transport. Fastify's reply doesn't implement the Node
 * http.ServerResponse interface the Node transport wants, so we use
 * the Web Standard transport directly and bridge Fastify's
 * request/reply pair to a fetch Request/Response.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerTools, type McpTool } from './registry.js';
import { McpService, type McpServiceOptions } from './service.js';
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
import type { FastifyRequest, FastifyReply } from 'fastify';

const TOOLS: McpTool[] = [
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

/**
 * Read the request body to a buffer. We need this because the fetch
 * Request body expects either a string, Buffer, or stream �?and the
 * raw Node IncomingMessage stream needs to be fully read before the
 * SDK can parse it.
 */
function readBody(req: FastifyRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.raw.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.raw.on('end', () => resolve(Buffer.concat(chunks)));
    req.raw.on('error', reject);
  });
}

/**
 * Bridge a Fastify request/reply pair into a fetch Request, dispatch
 * through the Web Standard transport, and write the resulting Response
 * back to the Fastify reply.
 */
async function bridgeFastifyToMcp(
  req: FastifyRequest,
  reply: FastifyReply,
  handle: (request: Request) => Promise<Response>
): Promise<void> {
  const protocol = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const host = (req.headers['host'] as string | undefined) ?? '127.0.0.1:3131';
  const url = `${protocol}://${host}${req.url}`;

  let body: Buffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // We registered a permissive application/json parser that just
    // hands the raw string to req.body. Forward it unchanged so the
    // SDK sees the bytes the client actually sent.
    if (typeof req.body === 'string') {
      body = Buffer.from(req.body, 'utf8');
    } else if (req.body !== undefined && req.body !== null) {
      // Fallback: if a stricter parser was installed by some other
      // route, req.body might be the parsed object. Re-serialize.
      body = Buffer.from(JSON.stringify(req.body), 'utf8');
    } else {
      body = await readBody(req);
    }
  }

  const headerEntries: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headerEntries.push([k, Array.isArray(v) ? v.join(', ') : String(v)]);
  }
  const init: RequestInit = {
    method: req.method,
    headers: headerEntries
  };
  if (body) {
    // BodyInit accepts Uint8Array; Buffer is a Uint8Array subclass but
    // TS narrows the union to URLSearchParams | FormData | etc. Cast
    // through `unknown` since at runtime a Buffer is a valid body.
    init.body = body as unknown as BodyInit;
  }

  const fetchReq = new Request(url, init);
  const fetchRes = await handle(fetchReq);

  reply.status(fetchRes.status);
  fetchRes.headers.forEach((value, key) => {
    reply.header(key, value);
  });
  const out = Buffer.from(await fetchRes.arrayBuffer());
  await reply.send(out);
}

/**
 * Per-request handler that owns one McpServer + one Web Standard
 * transport. Each HTTP request gets a fresh transport (stateless
 * mode), avoiding transport-state leaks across requests.
 */
export function buildMcpHandler(options: McpServiceOptions) {
  const service = new McpService(options);
  return async function handleMcpRequest(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    const server = new McpServer({ name: 'memweave-mcp', version: '0.4.0' });
    registerTools(server, service, TOOLS);
    await server.connect(transport);
    await bridgeFastifyToMcp(req, reply, (request) => transport.handleRequest(request));
  };
}


