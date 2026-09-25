type ToolDescriptor = { _meta?: { securitySchemes?: unknown }; securitySchemes?: unknown };
type ToolListEnvelope = { result?: { tools?: ToolDescriptor[] } };

/** Add top-level tool OAuth metadata absent from the current SDK wire output. */
export async function addToolSecurityMetadata(response: Response): Promise<Response> {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return response;
  let envelope: ToolListEnvelope;
  try { envelope = await response.clone().json() as ToolListEnvelope; }
  catch { return response; }
  if (!Array.isArray(envelope.result?.tools)) return response;
  let changed = false;
  for (const tool of envelope.result.tools) {
    if (tool.securitySchemes === undefined && Array.isArray(tool._meta?.securitySchemes)) {
      tool.securitySchemes = tool._meta.securitySchemes;
      changed = true;
    }
  }
  if (!changed) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return Response.json(envelope, { status: response.status, headers });
}
