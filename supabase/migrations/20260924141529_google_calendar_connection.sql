-- Google Calendar credentials stay behind a server-only secret API key.
-- The encrypted refresh token is never returned from a public RPC or AppState.
create table public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_ciphertext text not null check (length(refresh_token_ciphertext) between 40 and 8192),
  selected_calendar_ids text[] not null default array['primary']::text[],
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  constraint google_calendar_selection_limit check (cardinality(selected_calendar_ids) <= 50)
);

alter table public.google_calendar_connections enable row level security;
revoke all on public.google_calendar_connections from public, anon, authenticated;
grant select, insert, update, delete on public.google_calendar_connections to service_role;

comment on table public.google_calendar_connections is
  'Server-only Google Calendar OAuth grant. Ciphertext is AES-256-GCM encrypted by the application; no user-facing table grant.';
