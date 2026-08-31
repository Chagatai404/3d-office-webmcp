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
    // Spec/type shape is `Record<string, unknown>` per the current WebMCP
    // draft, but the shipped Chrome 151 implementation (WebMCP-testing flag)
    // actually requires `input` to already be a JSON *string* -- passing a
    // plain object throws `Failed to parse input arguments`. Verified live
    // against document.modelContext in Chrome DevTools; see
    // docs/webmcp-demo.md's Chrome setup section. Re-check against a newer
    // Chrome build before assuming either shape.
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
