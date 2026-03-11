# Elysia MCP Plugin

Elysia adapter for building [Model Context Protocol](https://modelcontextprotocol.io/) servers over the official MCP SDK's Streamable HTTP transport.

This fork is maintained around the MCP HTTP spec dated November 25, 2025. The package owns Elysia integration, request validation, and a small auth-discovery surface. It does not own custom transport semantics or a full OAuth server implementation.

## What This Fork Maintains

- Streamable HTTP via the official SDK `WebStandardStreamableHTTPServerTransport`
- Stateful sessions and optional stateless mode
- Default `Origin` validation for HTTP MCP servers
- Single-message `POST` enforcement for Streamable HTTP
- Protected resource metadata publishing
- Bearer challenge helpers for caller-managed auth

## Installation

```bash
bun add elysia-mcp
# or
npm install elysia-mcp
```

## Quick Start

```ts
import { Elysia } from 'elysia';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcp } from 'elysia-mcp';

const app = new Elysia().use(
  mcp({
    serverInfo: {
      name: 'my-mcp-server',
      version: '1.0.0',
    },
    capabilities: {
      tools: {},
    },
    setupServer: async (server: McpServer) => {
      server.registerTool(
        'echo',
        {
          description: 'Echo back a string',
          inputSchema: {
            text: z.string().describe('Text to echo'),
          },
        },
        async ({ text }) => ({
          content: [{ type: 'text', text: `Echo: ${text}` }],
        })
      );
    },
  })
);

app.listen(3000);
```

Connect an MCP client to `http://localhost:3000/mcp`.

## Transport Contract

- `POST` requests must contain exactly one JSON-RPC message. Batch bodies are rejected with `400 Invalid Request`.
- Requests with an `Origin` header must match the request origin or an explicitly allowed origin.
- Requests without an `Origin` header are allowed.
- The adapter delegates transport behavior to the MCP SDK instead of reimplementing SSE or Streamable HTTP internals.

## Auth Model

The `authentication` hook is intentionally small:

- You validate credentials and decide authorization.
- You return `authInfo` when the request is allowed.
- You return a `Response` when the request should be rejected.

This package does not validate tokens, run OAuth flows, or manage authorization-server metadata for you.

### Protected Resource Metadata

When `protectedResourceMetadata` is configured, the plugin serves:

```text
/.well-known/oauth-protected-resource{basePath}
```

For the default base path, that is `/.well-known/oauth-protected-resource/mcp`.

### Protected Server Example

```ts
import { Elysia } from 'elysia';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  createUnauthorizedResponse,
  getOAuthProtectedResourceMetadataUrl,
  mcp,
} from 'elysia-mcp';

const app = new Elysia().use(
  mcp({
    protectedResourceMetadata: {
      authorizationServers: ['https://auth.example.com'],
      scopesSupported: ['profile:read'],
      resourceName: 'Example MCP Server',
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
```

## Configuration

`MCPPluginOptions`:

- `basePath`: MCP route prefix. Defaults to `/mcp`.
- `serverInfo`: MCP server name and version.
- `capabilities`: Advertised server capabilities.
- `setupServer`: Callback for registering tools, resources, and prompts.
- `enableJsonResponse`: Enable JSON response mode where supported by the SDK.
- `stateless`: Disable session management.
- `mcpServer`: Provide your own `McpServer` instance.
- `eventStore`: Event storage for resumability support.
- `logger`: Custom logger implementing `ILogger`.
- `enableLogging`: Deprecated convenience flag for the default logger.
- `authentication`: Caller-managed auth hook returning `authInfo` or a rejection `Response`.
- `protectedResourceMetadata`: Metadata for OAuth protected resource discovery.
- `allowedOrigins`: Additional allowed values for the HTTP `Origin` header.
- `unsafeDisableOriginCheck`: Disable the default origin check.

Auth helpers exported by this package:

- `createUnauthorizedResponse`
- `createInsufficientScopeResponse`
- `getOAuthProtectedResourceMetadataPath`
- `getOAuthProtectedResourceMetadataUrl`

## Examples

```bash
bun run example
bun run example:multi
bun run example:auth
```

The repository examples live in [`example/`](./example).

## Development

```bash
bun test
bun run build
```

## Related

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [ElysiaJS](https://elysiajs.com/)

## License

MIT
