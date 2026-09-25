import type { SupabaseClient } from "@supabase/supabase-js";
import { commandSchema } from "../domain/commands";
import { emptyState, type AppState } from "../domain/types";
import { ApiError } from "./http";
import { databaseError } from "./service";

/** The client must use the server-held service key, and userId must be verified by MCP auth. */
export async function getMcpOwnerState(client: SupabaseClient, userId: string): Promise<AppState> {
  const { data, error } = await client.rpc("mcp_owner_state", { p_user_id: userId });
  if (error) databaseError(error);
  return { ...emptyState(true), ...data, configured: true, authenticated: true } as AppState;
}

export async function executeMcpOwnerCommand(client: SupabaseClient, userId: string, input: unknown) {
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
  if (error) databaseError(error);
  const result = data as { id: string; request_id: string; replayed: boolean };
  return { ...result, ok: true as const };
}

