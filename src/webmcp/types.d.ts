export {};

declare global {
  interface WebMcpToolAnnotations {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  }

  interface WebMcpToolDefinition {
    name: string;
    title?: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: WebMcpToolAnnotations;
    execute(
      input: unknown,
      options: { signal: AbortSignal },
    ): unknown | Promise<unknown>;
  }

  interface WebMcpRegisteredTool {
    name: string;
    title?: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: WebMcpToolAnnotations;
  }

  interface WebMcpModelContext extends EventTarget {
    registerTool(
      definition: WebMcpToolDefinition,
      options?: { signal?: AbortSignal; exposedTo?: string[] },
    ): Promise<void>;
    getTools(options?: { fromOrigins?: string[] }): Promise<WebMcpRegisteredTool[]>;
    executeTool(
      tool: WebMcpRegisteredTool,
      input?: Record<string, unknown>,
      options?: { signal?: AbortSignal },
    ): Promise<string>;
  }

  interface Document {
    modelContext?: WebMcpModelContext;
  }
}
