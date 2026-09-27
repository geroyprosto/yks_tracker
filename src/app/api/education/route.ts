import { executeEducationCommand, getEducation, requireEducationUser } from '@/lib/server/education';
import { errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';
export const dynamic='force-dynamic';
export async function GET(){try{return json(await getEducation(await requireEducationUser()));}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{sameOrigin(request);const client=await requireEducationUser();return json(await executeEducationCommand(client,await readJson(request,64000)));}catch(error){return errorResponse(error);}}
