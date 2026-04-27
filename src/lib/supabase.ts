import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

function getAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
}

// Client-side Supabase client (for realtime subscriptions + reads)
// Lazy-initialized to avoid crashing at build time when env vars are empty
let _client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(getUrl(), getAnonKey());
  }
  return _client;
}

// Convenience alias
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Server-side Supabase client (for API route mutations)
export function createServerClient(): SupabaseClient {
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || getAnonKey();
  return createClient(getUrl(), serviceKey);
}
