import { createMcpHandler } from "@modelcontextprotocol/server";
import { fromSupabaseUrl, withOAuthProtectedResource } from "@supabase/server";
import { authenticateMcpRequest, getMcpConfiguration } from "./mcp-auth";
import { createStudyMcpServer } from "./mcp-tools";
import { addToolSecurityMetadata } from "./mcp-security-metadata";
import { mcpTransportDiagnostic } from "./mcp-diagnostics";
import { readMcpBody } from "./mcp-request-body";

export async function handleMcpRequest(request: Request): Promise<Response> {
  const config = getMcpConfiguration();
  if (!config) {
    return Response.json({ error: { code: "MCP_NOT_CONFIGURED", message: "MCP bağlantısı henüz kurulmadı." } },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  // This middleware serves OAuth Protected Resource Metadata before the auth gate
  // and adds its discovery challenge to every unauthenticated 401.
  const protectedHandler = withOAuthProtectedResource({
    resourceServer: config.resource,
    authorizationServer: fromSupabaseUrl(config.supabaseUrl),
    errors: { detailed: false },
  }, async (innerRequest: Request) => {
    const origin = innerRequest.headers.get("origin");
    if (origin && origin !== new URL(config.resource).origin) {
      return Response.json({ error: { code: "ORIGIN_DENIED", message: "İstek kaynağına izin verilmedi." } }, { status: 403 });
    }
    if (innerRequest.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS" } });
    }

    const authorized = await authenticateMcpRequest(innerRequest, config);
    if (authorized instanceof Response) return authorized;

    let rpcBody: unknown;
    if (innerRequest.method === "POST") {
      const parsed = await readMcpBody(innerRequest);
      if (parsed instanceof Response) return parsed;
      rpcBody = parsed.parsedBody;
    }
    const toolListRequest = rpcBody !== null && typeof rpcBody === "object" &&
      !Array.isArray(rpcBody) && "method" in rpcBody && rpcBody.method === "tools/list";
    const handler = createMcpHandler(
      () => createStudyMcpServer(authorized.client, authorized.userId, config.appUrl),
      { responseMode: "json" },
    );
    const rawResponse = await handler.fetch(innerRequest, innerRequest.method === "POST" ? { parsedBody: rpcBody } : undefined);
    const diagnostic = await mcpTransportDiagnostic(innerRequest, rpcBody, rawResponse);
    if (diagnostic) console.warn("MCP_TRANSPORT_REJECTED", JSON.stringify(diagnostic));
    const response = toolListRequest ? await addToolSecurityMetadata(rawResponse) : rawResponse;
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
  return protectedHandler(request);
}

