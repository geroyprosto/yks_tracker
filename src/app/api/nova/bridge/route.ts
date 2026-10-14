import {json} from '@/lib/server/http';
export const dynamic='force-dynamic';
export async function POST(){
 return json({ok:false,error:{code:'NOVA_CHAT_REMOVED',message:'Nova’nın yerel model sohbeti kaldırıldı. Nova Bugün, Yarış ve Nova Lab kullanılabilir.'}},410);
}
