import { handleMcpRequest } from "@/lib/server/mcp-handler";

export const runtime = "nodejs";
export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const OPTIONS = handleMcpRequest;
