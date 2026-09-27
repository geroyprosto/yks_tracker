import { NextResponse, after } from 'next/server';
import { authClient } from '@/lib/server/auth';
import { deliverApplicationEmails } from '@/lib/server/classroom-email';
import { ensureClassroomApplication } from '@/lib/server/classroom-application';
import { errorResponse, privateHeaders } from '@/lib/server/http';
import { authOrigin, verifyAuthCallback } from '@/lib/server/password-recovery';
export async function GET(request:Request){
  const url=new URL(request.url);
  let origin:string;
  try{origin=authOrigin();}catch(error){return errorResponse(error);}
  const redirect=(path:string)=>NextResponse.redirect(new URL(path,origin),{headers:{...privateHeaders,'Referrer-Policy':'no-referrer'}});
  try{const client=await authClient();
    const {user,recovery}=await verifyAuthCallback(client,url);
    // Recovering credentials must never submit an application or change approval.
    if(recovery)return redirect('/reset-password');
    const account=await ensureClassroomApplication(client,user);
    after(()=>deliverApplicationEmails().then(()=>undefined));
    return redirect(account?.role==='student'&&account.status==='approved'?'/':'/classroom');
  }catch{return redirect(url.searchParams.get('type')==='recovery'?'/reset-password?error=verification':'/register?error=verification');}
}
