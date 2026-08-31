import { describe, expect, it } from "vitest";
import {
  executeToolSafely,
  MAX_WEBMCP_RESULT_BYTES,
} from "@/webmcp/tool-result";

describe("WebMCP result transport bound", () => {
  it("returns normal structured results below the ceiling", async () => {
    const output = await executeToolSafely(
      () => ({ ok: true, data: { value: "small" }, roomVersion: 4, message: "Loaded." }),
      () => 4,
    );
    expect(JSON.parse(output)).toMatchObject({ ok: true, data: { value: "small" } });
  });

  it("replaces oversized output with a bounded refusal and recovery path", async () => {
    const output = await executeToolSafely(
      () => ({
        ok: true,
        data: { untrustedRoomContent: "x".repeat(MAX_WEBMCP_RESULT_BYTES + 1) },
        roomVersion: 9,
        message: "Loaded.",
      }),
      () => 9,
    );
    expect(new TextEncoder().encode(output).byteLength).toBeLessThan(MAX_WEBMCP_RESULT_BYTES);
    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "The tool result is too large to return safely.",
      },
      roomVersion: 9,
    });
  });
});
