import {novaBridge} from '@/lib/server/nova';
import {errorResponse,json,readJson} from '@/lib/server/http';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{return json(await novaBridge(request,await readJson(request,24000)));}catch(error){return errorResponse(error);}}
