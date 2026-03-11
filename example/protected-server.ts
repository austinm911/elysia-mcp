import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Elysia } from 'elysia';
import {
  createUnauthorizedResponse,
  getOAuthProtectedResourceMetadataUrl,
  mcp,
} from '../src/index.js';

const app = new Elysia().use(
  mcp({
    serverInfo: {
      name: 'elysia-mcp-protected-example',
      version: '1.0.0',
    },
    capabilities: {
      tools: {},
    },
    protectedResourceMetadata: {
      authorizationServers: ['https://auth.example.com'],
      scopesSupported: ['profile:read'],
      resourceName: 'Protected Example MCP Server',
    },
    authentication: async context => {
      const url = new URL(context.request.url);
      const metadataPath = '/.well-known/oauth-protected-resource/mcp';

      if (
        (context.request.method === 'GET' && url.pathname === metadataPath) ||
        (context.request.method === 'POST' && isInitializeRequest(context.body))
      ) {
        return {};
      }

      const authHeader = context.request.headers.get('authorization');
      if (authHeader !== 'Bearer dev-token') {
        return {
          response: createUnauthorizedResponse({
            errorDescription: 'Missing or invalid bearer token',
            resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
              context.request.url,
              '/mcp'
            ),
          }),
        };
      }

      return {
        authInfo: {
          token: 'dev-token',
          clientId: 'local-dev',
          scopes: ['profile:read'],
        },
      };
    },
    setupServer: async (server: McpServer) => {
      server.registerTool(
        'whoami',
        {
          description: 'Return the authenticated client id',
          inputSchema: {},
        },
        async (_args, extra) => ({
          content: [
            {
              type: 'text',
              text: `clientId=${extra.authInfo?.clientId ?? 'unknown'}`,
            },
          ],
        })
      );
    },
  })
);

app.listen(3000);

console.log('Protected MCP example listening on http://localhost:3000/mcp');
console.log(
  'Protected resource metadata: http://localhost:3000/.well-known/oauth-protected-resource/mcp'
);
console.log('Use Authorization: Bearer dev-token for protected requests');
