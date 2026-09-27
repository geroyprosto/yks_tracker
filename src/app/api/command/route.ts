import { requireStudyUser } from "@/lib/server/classroom";
import { executeCommand } from "@/lib/server/service";
import { errorResponse, json, readJson, sameOrigin } from "@/lib/server/http";
export async function POST(request:Request){try{sameOrigin(request);const client=await requireStudyUser();return json(await executeCommand(client,await readJson(request)));}catch(error){return errorResponse(error);}}
