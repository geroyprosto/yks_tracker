export class ApiError extends Error {
  constructor(public status:number,public code:string,message:string){super(message);}
}
export const privateHeaders={"Cache-Control":"private, no-store, max-age=0","Vary":"Cookie","X-Content-Type-Options":"nosniff"};
export function json(data:unknown,status=200){return Response.json(data,{status,headers:privateHeaders});}
export function errorResponse(error:unknown){
 if(error instanceof ApiError)return json({ok:false,error:{code:error.code,message:error.message}},error.status);
 return json({ok:false,error:{code:"SERVER_ERROR",message:"İşlem tamamlanamadı. Lütfen yeniden deneyin."}},500);
}
export function sameOrigin(request:Request){
 const origin=request.headers.get("origin");
  const requestUrl=new URL(request.url);
 // Next may canonicalize 127.0.0.1 to localhost in request.url. The actual Host
 // header is browser-controlled and cannot be forged by a cross-origin form.
 const host=request.headers.get("host")??requestUrl.host;
 const expected=process.env.APP_ORIGIN?new URL(process.env.APP_ORIGIN).origin:new URL(`${requestUrl.protocol}//${host}`).origin;
 if(!origin||origin!==expected)throw new ApiError(403,"ORIGIN_REJECTED","Bu istek için aynı uygulamadan işlem yapmalısınız.");
}
export async function readJson(request:Request,maxBytes=64000):Promise<unknown>{
 if(!request.headers.get("content-type")?.includes("application/json"))throw new ApiError(415,"JSON_REQUIRED","JSON içerik gerekli.");
 const reader=request.body?.getReader();
 if(!reader)throw new ApiError(400,"INVALID_INPUT","İstek gövdesi eksik.");
 const decoder=new TextDecoder();let size=0;let text="";
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new ApiError(413,"BODY_TOO_LARGE","İstek çok büyük.");}text+=decoder.decode(value,{stream:true});}
 text+=decoder.decode();
 try{return JSON.parse(text);}catch{throw new ApiError(400,"INVALID_INPUT","Geçerli JSON gerekli.");}
}

