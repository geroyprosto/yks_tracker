import { publicClassroomClient } from '@/lib/server/classroom';
import { ApiError, errorResponse, json } from '@/lib/server/http';
import { databaseError } from '@/lib/server/service';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const token=new URL(request.url).searchParams.get('token');if(!token||!/^[a-f0-9]{64}$/.test(token))throw new ApiError(404,'INVALID_INVITE','Davet bulunamadı veya süresi dolmuş.');const {data,error}=await (await publicClassroomClient()).rpc('classroom_invite',{token});if(error)databaseError(error);if(!data)throw new ApiError(404,'INVALID_INVITE','Davet iptal edilmiş veya süresi dolmuş.');return json(data);}catch(error){return errorResponse(error);}}
