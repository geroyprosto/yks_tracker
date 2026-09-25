import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ApiError } from "./http";
export function getConfiguration(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 const email=process.env.ALLOWED_USER_EMAIL?.trim().toLowerCase();
 if(!url||!key||!email||url.includes("PROJECT")||key.includes("REPLACE")||email==="you@example.com")return null;
 try{const parsed=new URL(url);if(parsed.protocol!=="https:"&&parsed.hostname!=="localhost"&&parsed.hostname!=="127.0.0.1")return null;}catch{return null;}
 return {url,key,email};
}
export async function authClient(){
 const config=getConfiguration();if(!config)throw new ApiError(503,"SETUP_REQUIRED","Supabase bağlantısı ve sahip hesap kurulumu gerekli.");
 const jar=await cookies();
 return createServerClient(config.url,config.key,{cookies:{getAll:()=>jar.getAll(),setAll:values=>{for(const {name,value,options} of values)jar.set(name,value,{...options,httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production"});}}});
}
export async function requireOwner(){
 const client=await authClient();
 // getUser contacts Auth; never authorize using unverified getSession data.
 const {data,error}=await client.auth.getUser();
 if(error||!data.user)throw new ApiError(401,"SIGN_IN_REQUIRED","Devam etmek için giriş yapın.");
 if(data.user.email?.toLowerCase()!==getConfiguration()!.email)throw new ApiError(403,"OWNER_REQUIRED","Bu hesap uygulamanın sahibi değil.");
 const allowed=await client.from("owner_allowlist").select("user_id").eq("user_id",data.user.id).maybeSingle();
 if(allowed.error)throw new ApiError(503,"DATABASE_SETUP_REQUIRED","Veritabanı migration ve sahip hesap kurulumu gerekli.");
 if(!allowed.data)throw new ApiError(403,"OWNER_REQUIRED","Bu hesap için erişim tanımlı değil.");
 return client;
}
