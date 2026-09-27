import { isJsonContentType } from "@modelcontextprotocol/server";

// Match the SDK limit even when its parsedBody option bypasses the built-in reader.
export const MAX_MCP_BODY_BYTES = 4 * 1024 * 1024;
function bodyError(status: number, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null },
    { status, headers: { "Cache-Control": "no-store" } });
}

/** Consume the authenticated POST once; never ask the SDK to reread a hosted request stream. */
export async function readMcpBody(request: Request): Promise<{ parsedBody: unknown } | Response> {
  if (!isJsonContentType(request.headers.get("content-type")))
    return bodyError(415, -32000, "Unsupported Media Type: Content-Type must be application/json");
  const tooLarge = () => bodyError(413, -32000, `Payload Too Large: Request body must not exceed ${MAX_MCP_BODY_BYTES} bytes`);
  if (Number(request.headers.get("content-length")) > MAX_MCP_BODY_BYTES) return tooLarge();
  let text = "";
  try {
    const reader = request.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_MCP_BODY_BYTES) {
            void reader.cancel().catch(() => {});
            return tooLarge();
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
    }
  } catch { return bodyError(400, -32700, "Parse error: the request body could not be read"); }
  try { return { parsedBody: JSON.parse(text) }; }
  catch { return bodyError(400, -32700, "Parse error: Invalid JSON"); }
}
