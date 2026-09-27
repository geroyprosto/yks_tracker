import {redirect} from 'next/navigation';
import {classroomContext} from '@/lib/server/classroom';
import {getEducation} from '@/lib/server/education';
import {ApiError} from '@/lib/server/http';
import {PersonalizationPage} from '@/components/personalization-page';

export const dynamic='force-dynamic';
export default async function Personalize(){
 let context;
 try{context=await classroomContext({readOnly:true});}
 catch(error){if(error instanceof ApiError&&error.status===401)redirect('/');throw error;}
 if(!context.user.email_confirmed_at||context.account?.role!=='student'||!['pending','approved'].includes(context.account.status))redirect('/classroom');
 return <PersonalizationPage initialEducation={await getEducation(context.client)}/>;
}
