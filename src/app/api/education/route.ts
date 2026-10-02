import { executeEducationCommand, getEducation, requireEducationUser } from '@/lib/server/education';
import { errorResponse, json, readJson, sameOrigin } from '@/lib/server/http';
export const dynamic='force-dynamic';
export async function GET(){try{return json(await getEducation(await requireEducationUser()));}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{sameOrigin(request);const client=await requireEducationUser();const minimal=request.headers.get('prefer')?.split(',').some(value=>value.trim().toLowerCase()==='return=minimal')??false;return json(await executeEducationCommand(client,await readJson(request,64000),{minimal}));}catch(error){return errorResponse(error);}}
