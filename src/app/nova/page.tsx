import {NovaWorkspace} from '@/components/nova/workspace';
import {Login} from '@/components/login';
import {classroomContext} from '@/lib/server/classroom';
import {ApiError} from '@/lib/server/http';
export const dynamic='force-dynamic';
export default async function NovaPage(){
 try{await classroomContext({readOnly:true});}catch(error){if(error instanceof ApiError&&error.status===401)return <Login/>;if(error instanceof ApiError&&error.status===503)return <main className="login-page"><p>Nova için hesap ve veritabanı kurulumu gerekli.</p></main>;throw error;}
 return <NovaWorkspace standalone/>;
}
