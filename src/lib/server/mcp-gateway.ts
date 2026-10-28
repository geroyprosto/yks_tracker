import type { SupabaseClient } from "@supabase/supabase-js";
import { commandSchema } from "../domain/commands";
import { emptyState, type AppState } from "../domain/types";
import { ApiError } from "./http";
import { databaseError } from "./service";
import {scheduleStudyDirty,type StudyDirtyOptions} from './study-realtime';

const pendingStateReads=new WeakMap<SupabaseClient,Map<string,Promise<AppState>>>();

/** The client must use the server-held service key, and userId must be verified by MCP auth. */
export async function getMcpOwnerState(client: SupabaseClient, userId: string): Promise<AppState> {
  let reads=pendingStateReads.get(client);
  if(!reads){reads=new Map();pendingStateReads.set(client,reads);}
  const existing=reads.get(userId);
  if(existing)return existing;
  const read=Promise.resolve(client.rpc("mcp_owner_state", { p_user_id: userId })).then(({data,error})=>{
    if(error)databaseError(error,'mcp_owner_state');
    return { ...emptyState(true), ...data, configured: true, authenticated: true } as AppState;
  });
  reads.set(userId,read);
  // Share concurrent summary/analysis reads only while their RPC is pending.
  // A write or newer read can replace this entry before it completes.
  const release=()=>{if(reads.get(userId)===read)reads.delete(userId);};
  void read.then(release,release);
  return read;
}

export async function getMcpOwnerRead(client:SupabaseClient,userId:string,resource:'tasks'|'topics'|'sessions'|'exams',filters:Record<string,unknown>){
  const {data,error}=await client.rpc('mcp_owner_read',{p_user_id:userId,p_resource:resource,p_filters:filters});
  if(error)databaseError(error,'mcp_owner_read');
  return data;
}

export async function executeMcpOwnerCommand(client: SupabaseClient, userId: string, input: unknown,notification?:StudyDirtyOptions) {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Alanları kontrol edin.");
  }
  const { data, error } = await client.rpc("mcp_owner_command", {
    p_user_id: userId,
    request_id: parsed.data.request_id,
    command_type: parsed.data.type,
    payload: parsed.data.payload,
  });
  if (error) databaseError(error,'mcp_owner_command');
  pendingStateReads.get(client)?.delete(userId);
  scheduleStudyDirty(client,{...notification,verifiedUserId:userId});
  const result = data as { id: string; request_id: string; replayed: boolean };
  return { ...result, ok: true as const };
}

