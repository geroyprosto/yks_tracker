import { classroomContext } from '@/lib/server/classroom';
import { demoEnabled } from '@/lib/server/classroom-demo';
import { ApiError, errorResponse, json } from '@/lib/server/http';
export const dynamic='force-dynamic';
export async function GET(){try{const {account,demo}=await classroomContext();return json({account,demo,demoEnabled:demoEnabled()});}catch(error){if(error instanceof ApiError && [401,503].includes(error.status))return json({account:null,demo:false,demoEnabled:demoEnabled()});return errorResponse(error);}}
