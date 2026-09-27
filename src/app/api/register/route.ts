import { registrationDisplayName, registrationSchema } from '@/lib/classroom/registration';
import { authClient } from '@/lib/server/auth';
import { ApiError,errorResponse,json,readJson,sameOrigin } from '@/lib/server/http';
import { createDemoSession, demoClient, demoEnabled, demoQuery } from '@/lib/server/classroom-demo';
import { randomUUID } from 'node:crypto';
import { databaseError } from '@/lib/server/service';
import { registerWithoutEmail } from '@/lib/server/classroom-registration';
export async function POST(request:Request){try{
  sameOrigin(request);const input=registrationSchema.safeParse(await readJson(request,4096));
  if(!input.success)throw new ApiError(400,'INVALID_INPUT',input.error.issues[0]?.code==='unrecognized_keys'?'Başvuru alanları geçersiz.':input.error.issues[0]?.message??'Ad, soyad, e-posta ve şifre bilgilerini kontrol edin.');
  const {first_name,last_name,email,password,role,invite_token}=input.data;
  const name=registrationDisplayName(input.data);
  const reviewer=role==='student'&&invite_token?'Öğretmenin':'Yönetici';
  if(input.data.demo){
    if(!demoEnabled())throw new ApiError(404,'DEMO_DISABLED','Demo bu ortamda kapalı.');
    if(invite_token){const result=await demoClient(null).rpc('classroom_invite',{token:invite_token});if(result.error||!result.data)throw new ApiError(410,'INVALID_INVITE','Davet iptal edilmiş veya süresi dolmuş.');}
    const userId=await demoQuery(async db=>{
      // Demo identities stay in an isolated database. No password is stored or email sent.
      if((await db.query('select id from auth.users where lower(email)=lower($1)',[email])).rows.length)throw new ApiError(409,'DEMO_ACCOUNT_EXISTS','Bu demo e-postası mevcut. Demo hesap listesinden giriş yapın.');
      const id=randomUUID();await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,email]);return id;
    });
    const applied=await demoClient(userId).rpc('classroom_apply',{display_name:name,requested_role:role,invite_token:invite_token??null});if(applied.error)databaseError(applied.error);
    await createDemoSession(userId);return json({ok:true,status:'pending',demo:true,redirect:'/classroom',message:`Demo başvurun oluşturuldu. ${reviewer} onaylayana kadar erişim bekleyecek; e-posta gönderilmedi.`});
  }
  if(!password||password.length<10)throw new ApiError(400,'INVALID_INPUT','En az 10 karakterli şifre girin.');
  const client=await authClient();
  if(invite_token){const preview=await client.rpc('classroom_invite',{token:invite_token});if(preview.error||!preview.data)throw new ApiError(410,'INVALID_INVITE','Davet iptal edilmiş veya süresi dolmuş.');}
  const account=await registerWithoutEmail(client,request,{email,password,name,first_name,last_name,role,invite_token:invite_token??null});
  if(account.status!=='pending')throw new ApiError(503,'APPLICATION_FAILED','Hesap oluşturuldu; başvuru durumunu giriş yaparak kontrol et.');
  return json({ok:true,status:'pending',redirect:'/classroom',message:`Başvurun ${reviewer.toLocaleLowerCase('tr-TR')} ekranına iletildi. Onaydan sonra hesabını kullanabilirsin; e-posta gönderilmedi.`});
}catch(error){return errorResponse(error);}}
