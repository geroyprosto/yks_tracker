import {novaCommand,novaState} from '@/lib/server/nova';
import {errorResponse,json,readJson,sameOrigin} from '@/lib/server/http';
export const dynamic='force-dynamic';
export async function GET(){try{return json(await novaState());}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{sameOrigin(request);return json(await novaCommand(await readJson(request,10000)));}catch(error){return errorResponse(error);}}
