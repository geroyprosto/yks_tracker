import {createServerClient} from '@supabase/ssr';
import {NextResponse,type NextRequest} from 'next/server';
import {getConfiguration} from '@/lib/server/auth';
export async function proxy(request:NextRequest){
 const config=getConfiguration();if(!config)return NextResponse.next();
 let response=NextResponse.next({request});
 const db=createServerClient(config.url,config.key,{cookies:{
  getAll(){return request.cookies.getAll()},
  setAll(values){
   values.forEach(({name,value})=>request.cookies.set(name,value));
   response=NextResponse.next({request});
   values.forEach(({name,value,options})=>response.cookies.set(name,value,{...options,httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'}));
  }
 }});
 await db.auth.getClaims();
 response.headers.set('Cache-Control','private, no-store');
 return response;
}
export const config={matcher:['/','/calendar/:path*','/classroom/:path*','/api/:path*']};
