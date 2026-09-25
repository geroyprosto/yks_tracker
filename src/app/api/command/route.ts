import { requireOwner } from "@/lib/server/auth";
import { executeCommand } from "@/lib/server/service";
import { errorResponse, json, readJson, sameOrigin } from "@/lib/server/http";
export async function POST(request:Request){try{sameOrigin(request);const client=await requireOwner();return json(await executeCommand(client,await readJson(request)));}catch(error){return errorResponse(error);}}
