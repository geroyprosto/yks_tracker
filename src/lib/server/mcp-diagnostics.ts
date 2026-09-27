const knownMethods = new Set([
  "initialize", "notifications/initialized", "discover", "server/discover", "tools/list", "tools/call",
  "resources/list", "resources/templates/list", "prompts/list", "ping",
]);
const safeMessages = new Set([
  "Parse error", "Parse error: Invalid JSON", "Parse error: Invalid JSON-RPC message",
  "Parse error: the request body could not be read", "Parse error: the request body is not valid JSON",
  "Bad Request: Server not initialized", "Bad Request: Mcp-Session-Id header is required",
  "Invalid Request: Server already initialized", "Invalid Request: Only one initialization request is allowed",
  "Method not allowed.",
  "Bad Request: the request headers and body disagree: an initialize request (legacy handshake) was sent with a modern MCP-Protocol-Version header",
]);
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function protocol(value: unknown) {
  return value === undefined || value === null ? "missing"
    : typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "invalid";
}
function errorCategory(message: unknown) {
  if (typeof message !== "string") return "unknown";
  if (safeMessages.has(message)) return message;
  if (message.startsWith("Bad Request: Unsupported protocol version:") || message.startsWith("Unsupported protocol version")) return "unsupported_protocol_version";
  if (message.startsWith("Bad Request: the request headers and body disagree:")) return "protocol_header_body_mismatch";
  if (message.startsWith("Invalid _meta envelope") || message.startsWith("Invalid params: the MCP-Protocol-Version")) return "invalid_per_request_envelope";
  if (message.startsWith("Invalid Request: Batch must not exceed")) return "batch_too_large";
  return "unclassified_sdk_error";
}

/** Failure-only transport details. Never log headers, args, tokens, IDs or raw SDK error data. */
export async function mcpTransportDiagnostic(request: Request, body: unknown, response: Response) {
  if (response.status < 400) return null;
  let error: Record<string, unknown> = {};
  if (response.headers.get("content-type")?.includes("application/json")) {
    try { error = object(object(await response.clone().json()).error); } catch { /* No raw body fallback. */ }
  }
  const rpc = object(body);
  const params = object(rpc.params);
  const accept = request.headers.get("accept") ?? "";
  return {
    httpMethod: ["GET", "POST", "OPTIONS", "DELETE"].includes(request.method) ? request.method : "other",
    rpcMethod: typeof rpc.method === "string" && knownMethods.has(rpc.method) ? rpc.method : "unknown",
    protocolHeader: protocol(request.headers.get("mcp-protocol-version")),
    initializeProtocol: protocol(params.protocolVersion),
    hasMeta: params._meta !== undefined,
    hasMethodHeader: request.headers.has("mcp-method"),
    acceptsJson: accept.includes("application/json"),
    acceptsSse: accept.includes("text/event-stream"),
    status: response.status,
    errorCode: typeof error.code === "number" && Number.isSafeInteger(error.code) ? error.code : null,
    error: errorCategory(error.message),
  };
}
