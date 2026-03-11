import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  isInitializeRequest,
  SUPPORTED_PROTOCOL_VERSIONS,
  type ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';
import { Elysia } from 'elysia';
import { ElysiaStreamingHttpTransport } from './transport';
import type { EventStore, McpContext } from './types';
import { createLogger, type ILogger } from './utils/logger';

/**
 * Plugin options for the MCP Elysia plugin
 */
export interface MCPPluginOptions {
  /**
   * Base path for MCP endpoints (default: '/mcp')
   */
  basePath?: string;

  /**
   * Server information
   */
  serverInfo?: {
    name: string;
    version: string;
  };

  /**
   * MCP server capabilities
   */
  capabilities?: ServerCapabilities;

  /**
   * @deprecated Use logger option instead
   * Enable or disable logging
   */
  enableLogging?: boolean;

  /**
   * Custom logger instance (pino, winston, etc.)
   * If not provided and enableLogging is true, will use default console logger
   */
  logger?: ILogger;

  /**
   * Enable JSON response mode instead of SSE streaming
   */
  enableJsonResponse?: boolean;

  /**
   * Authentication handler
   */
  authentication?: (
    context: McpContext
  ) => Promise<{ authInfo?: AuthInfo; response?: unknown }>;

  /**
   * Setup function to configure the MCP server with tools, resources, and prompts
   */
  setupServer?: (server: McpServer) => void | Promise<void>;

  /**
   * Enable stateless mode (no session management)
   */
  stateless?: boolean;

  /**
   * Provide a custom MCP server instance
   */
  mcpServer?: McpServer;

  /**
   * Event store for resumability support
   */
  eventStore?: EventStore;

  /**
   * Additional allowed origins for HTTP requests.
   * Requests without an Origin header are allowed.
   * Requests with an Origin header must match the request origin or one of these values.
   */
  allowedOrigins?: string[];

  /**
   * Disable the default Origin validation required for HTTP MCP servers.
   * This is unsafe and should only be used behind trusted infrastructure.
   */
  unsafeDisableOriginCheck?: boolean;

  /**
   * Protected resource metadata published for MCP authorization discovery.
   */
  protectedResourceMetadata?: ProtectedResourceMetadataOptions;
}

export interface ProtectedResourceMetadataOptions {
  authorizationServers: string[];
  scopesSupported?: string[];
  resourceName?: string;
  resourceDocumentationUrl?: string;
}

export interface AuthChallengeOptions {
  error?: string;
  errorDescription?: string;
  resourceMetadataUrl?: string;
  scope?: string[];
}

export const transports: Record<string, ElysiaStreamingHttpTransport> = {};

// Export logger types and utilities for external use
export { type ILogger, ConsoleLogger, SilentLogger, createLogger } from './utils/logger';

const createJsonErrorResponse = (status: number, message: string, code = -32000) =>
  new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    }),
    {
      status,
      headers: {
        'content-type': 'application/json',
      },
    }
  );

const createJsonRpcErrorBody = (message: string, code = -32000) => ({
  jsonrpc: '2.0' as const,
  error: { code, message },
  id: null,
});

const buildWwwAuthenticateHeader = (options: AuthChallengeOptions = {}) => {
  let header = 'Bearer';

  if (options.error) {
    header += ` error="${options.error}"`;
  }

  if (options.errorDescription) {
    header += `${options.error ? ',' : ''} error_description="${options.errorDescription}"`;
  }

  if (options.scope && options.scope.length > 0) {
    header += `${options.error || options.errorDescription ? ',' : ''} scope="${options.scope.join(' ')}"`;
  }

  if (options.resourceMetadataUrl) {
    header += `${options.error || options.errorDescription || options.scope?.length ? ',' : ''} resource_metadata="${options.resourceMetadataUrl}"`;
  }

  return header;
};

export const createUnauthorizedResponse = (
  options: AuthChallengeOptions = {}
) =>
  new Response(
    JSON.stringify(
      createJsonRpcErrorBody(
        options.errorDescription ?? 'Unauthorized',
        -32000
      )
    ),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': buildWwwAuthenticateHeader({
          ...options,
          error: options.error ?? 'invalid_token',
        }),
      },
    }
  );

export const createInsufficientScopeResponse = (
  options: AuthChallengeOptions = {}
) =>
  new Response(
    JSON.stringify(
      createJsonRpcErrorBody(
        options.errorDescription ?? 'Insufficient scope',
        -32000
      )
    ),
    {
      status: 403,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': buildWwwAuthenticateHeader({
          ...options,
          error: options.error ?? 'insufficient_scope',
        }),
      },
    }
  );

const normalizeBasePath = (basePath: string) =>
  basePath === '/' ? '' : basePath.startsWith('/') ? basePath : `/${basePath}`;

export const getOAuthProtectedResourceMetadataPath = (basePath: string) =>
  `/.well-known/oauth-protected-resource${normalizeBasePath(basePath)}`;

export const getOAuthProtectedResourceMetadataUrl = (
  serverUrl: string | URL,
  basePath: string
) => new URL(getOAuthProtectedResourceMetadataPath(basePath), serverUrl).href;

const hasValidOrigin = (request: Request, allowedOrigins: string[] = []) => {
  const originHeader = request.headers.get('origin');
  if (!originHeader) {
    return true;
  }

  try {
    const requestOrigin = new URL(request.url).origin;
    const origin = new URL(originHeader).origin;
    return origin === requestOrigin || allowedOrigins.includes(origin);
  } catch {
    return false;
  }
};

// Main MCP plugin for Elysia
export const mcp = (options: MCPPluginOptions = {}) => {
  // Create MCP server singleton
  const serverInfo = options.serverInfo || {
    name: 'elysia-mcp-server',
    version: '1.0.0',
  };

  const server =
    options.mcpServer ||
    new McpServer(serverInfo, {
      capabilities: options.capabilities || {},
    });

  // Setup server with tools, resources, prompts once
  const setupPromise = (async () => {
    if (options.setupServer) {
      await options.setupServer(server);
    }
  })();

  const basePath = options.basePath || '/mcp';
  const protectedResourceMetadataPath =
    getOAuthProtectedResourceMetadataPath(basePath);
  
  // Create logger with support for custom logger instances
  const logger = createLogger({
    enabled: options.enableLogging ?? false,
    logger: options.logger,
  });
  // Shared handler function
  const mcpHandler = async (context: McpContext) => {
    const { request, set, body } = context;
    await setupPromise;

    logger.debug(
      `${request.method} ${request.url}`,
      body ? JSON.stringify(body) : ''
    );

    if (options.stateless) {
      const transport = new ElysiaStreamingHttpTransport({
        sessionIdGenerator: undefined,
        enableLogging: options.enableLogging,
        logger: options.logger,
        enableJsonResponse: options.enableJsonResponse,
      });

      const statelessServer =
        options.mcpServer ||
        new McpServer(serverInfo, {
          capabilities: options.capabilities || {},
        });
      if (options.setupServer) {
        await options.setupServer(statelessServer);
      }

      await statelessServer.connect(transport);

      //Receive response and close transport and server
      const response = await transport.handleRequest(context);
      transport.close();
      statelessServer.close();
      return response;
    }

    try {
      const sessionId = request.headers.get('mcp-session-id');
      if (sessionId) {
        if (isInitializeRequest(body)) {
          set.status = 400;
          return {
            jsonrpc: '2.0',
            error: {
              code: -32600,
              message: 'Invalid Request: Server already initialized',
            },
            id: null,
          };
        }
        const transport = transports[sessionId];
        if (!transport) {
          set.status = 404;
          return {
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Session not found' },
          };
        }
        return await transport.handleRequest(context);
      }

      const isInitialize =
        (Array.isArray(body) && body.some(isInitializeRequest)) ||
        isInitializeRequest(body);
      if (!sessionId && isInitialize) {
        const transport = new ElysiaStreamingHttpTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sessionId) => {
            transports[sessionId] = transport;
          },
          eventStore: options.eventStore,
          enableLogging: options.enableLogging,
          logger: options.logger,
          enableJsonResponse: options.enableJsonResponse,
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
          }
        };

        await server.connect(transport);

        return await transport.handleRequest(context);
      }

      // Invalid request
      set.status = 400;
      return {
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      };
    } catch (error) {
      set.status = 500;
      logger.error('Error handling MCP request', JSON.stringify(error));
      return {
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Internal error',
        },
        id: null,
      };
    }
  };

  const app = new Elysia({ name: `mcp-${serverInfo.name}` })
    .state('authInfo', undefined as AuthInfo | undefined)
    .onBeforeHandle(async (context) => {
      if (
        !options.unsafeDisableOriginCheck &&
        !hasValidOrigin(context.request, options.allowedOrigins)
      ) {
        return createJsonErrorResponse(403, 'Forbidden: Invalid Origin header');
      }

      const protocolVersion = context.request.headers.get(
        'mcp-protocol-version'
      );
      if (protocolVersion) {
        if (!SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
          context.set.status = 400;
          return {
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: `Bad Request: Unsupported protocol version (supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(
                ', '
              )})`,
            },
            id: null,
          };
        }
      }

      if (context.request.method === 'POST') {
        const contentType = context.request.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          context.set.status = 415;
          return {
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message:
                'Unsupported Media Type: Content-Type must be application/json',
            },
            id: null,
          };
        }

        if (Array.isArray(context.body)) {
          return createJsonErrorResponse(
            400,
            'Bad Request: Streamable HTTP POST requests must include exactly one JSON-RPC message',
            ErrorCode.InvalidRequest
          );
        }
      }

      if (options.authentication) {
        const { authInfo, response } = await options.authentication(context);
        // if authInfo is provided, store it in the context
        if (authInfo) {
          context.store.authInfo = authInfo;
          return;
        }
        // if response is provided, return response and do not continue
        if (response) {
          return response;
        }
        // if no authInfo or response is provided, continue
      }
    })
    .get(protectedResourceMetadataPath, ({ request, set }) => {
      if (!options.protectedResourceMetadata) {
        set.status = 404;
        return;
      }

      set.headers = {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      };

      return {
        resource: new URL(basePath, request.url).href,
        authorization_servers:
          options.protectedResourceMetadata.authorizationServers,
        scopes_supported: options.protectedResourceMetadata.scopesSupported,
        resource_name: options.protectedResourceMetadata.resourceName,
        resource_documentation:
          options.protectedResourceMetadata.resourceDocumentationUrl,
      };
    })
    .onError(({ error, code, set }) => {
      if (code === 'PARSE') {
        set.status = 400;
        return {
          jsonrpc: '2.0',
          error: {
            code: ErrorCode.ParseError,
            message: 'Parse error',
            data: String(error),
          },
          id: null,
        };
      }
    })
    .onAfterResponse(({ response }) => {
      if (response && typeof response === 'object') {
        logger.debug('response', JSON.stringify(response));
      }
    })
    .all(`${basePath}/*`, mcpHandler)
    .all(basePath, mcpHandler);

  return app;
};
