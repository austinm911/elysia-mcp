import {
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  JSONRPCMessage,
  MessageExtraInfo,
  RequestId,
} from '@modelcontextprotocol/sdk/types.js';
import type {
  McpContext,
  StreamableHTTPServerTransportOptions,
} from './types';

export class ElysiaStreamingHttpTransport implements Transport {
  private readonly transport: WebStandardStreamableHTTPServerTransport;

  constructor(options: StreamableHTTPServerTransportOptions) {
    this.transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: options.sessionIdGenerator,
      onsessioninitialized: options.onsessioninitialized,
      enableJsonResponse: options.enableJsonResponse,
      eventStore: options.eventStore,
      retryInterval: options.retryInterval,
    });
  }

  get sessionId(): string | undefined {
    return this.transport.sessionId;
  }

  set onclose(handler: (() => void) | undefined) {
    this.transport.onclose = handler;
  }

  get onclose(): (() => void) | undefined {
    return this.transport.onclose;
  }

  set onerror(handler: ((error: Error) => void) | undefined) {
    this.transport.onerror = handler;
  }

  get onerror(): ((error: Error) => void) | undefined {
    return this.transport.onerror;
  }

  set onmessage(
    handler:
      | ((message: JSONRPCMessage, extra?: MessageExtraInfo) => void)
      | undefined
  ) {
    this.transport.onmessage = handler;
  }

  get onmessage():
    | ((message: JSONRPCMessage, extra?: MessageExtraInfo) => void)
    | undefined {
    return this.transport.onmessage;
  }

  async start(): Promise<void> {
    return this.transport.start();
  }

  async handleRequest(context: McpContext): Promise<Response> {
    return this.transport.handleRequest(context.request, {
      authInfo: context.store.authInfo,
      parsedBody: context.body,
    });
  }

  async send(
    message: JSONRPCMessage,
    options?: { relatedRequestId?: RequestId }
  ): Promise<void> {
    return this.transport.send(message, options);
  }

  async close(): Promise<void> {
    return this.transport.close();
  }

  closeSSEStream(requestId: RequestId): void {
    this.transport.closeSSEStream(requestId);
  }

  closeStandaloneSSEStream(): void {
    this.transport.closeStandaloneSSEStream();
  }
}
