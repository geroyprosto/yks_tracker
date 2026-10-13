import {executeMedicineCommand,getMedicine,medicineContext} from '@/lib/server/medicine';
import {errorResponse,json,readJson,sameOrigin} from '@/lib/server/http';
export const dynamic='force-dynamic';
export async function GET(){
 try{return json(await getMedicine(await medicineContext()));}catch(error){return errorResponse(error);}
}
export async function POST(request:Request){
 try{sameOrigin(request);return json(await executeMedicineCommand(await medicineContext(),await readJson(request,64000)));}catch(error){return errorResponse(error);}
}
