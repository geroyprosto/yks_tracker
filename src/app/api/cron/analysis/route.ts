import {json} from '@/lib/server/http';
export const dynamic='force-dynamic';
export const runtime='nodejs';
// Retained endpoint for existing infrastructure; never starts paid work.
export async function GET(){return json({ok:false,error:{code:'AUTOMATIC_AI_DISABLED',message:'AI raporları yalnız kullanıcı isteğiyle oluşturulur.'}},410);}
