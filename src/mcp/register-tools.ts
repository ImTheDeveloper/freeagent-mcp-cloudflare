import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

export type OptionalArgsShape = z.ZodRawShape;

/**
 * Declared as a type alias, not an interface: the SDK's tool result type has an
 * index signature, and only type aliases get an implicit one.
 */
export type TextToolResponse = {
  content: Array<{
    type: "text";
    text: string;
  }>;
};

/**
 * Registers a tool whose arguments are all optional.
 *
 * The shape must be handed to the SDK as a raw shape. Wrapping it as
 * `z.object(shape).optional()` looks equivalent but is not: the SDK's schema
 * normalizer only recognizes object schemas, so a ZodOptional wrapper makes it
 * fall back to an empty schema and every parameter silently disappears from
 * `tools/list`. Callers then get default page sizes and no way to override them.
 */
export function registerOptionalTool(
  server: McpServer,
  name: string,
  shape: OptionalArgsShape,
  cb: (args: any) => Promise<TextToolResponse> | TextToolResponse,
  description?: string,
): void {
  server.registerTool(name, { description, inputSchema: shape }, async (args: unknown) =>
    cb((args ?? {}) as any),
  );
}
