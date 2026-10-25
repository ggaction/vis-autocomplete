import { createClient } from '@supabase/supabase-js';

export function createTokenVerifier(config) {
  if (!config.supabaseUrl || !config.supabaseKey) return async () => false;
  const client = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(5000) }) },
  });
  return async token => {
    try {
      // Validate with the auth server; decoding a browser-supplied JWT is not
      // authentication. Never log or persist the bearer token or chart body.
      const { data, error } = await client.auth.getUser(token);
      return !error && Boolean(data.user?.id);
    } catch { return false; }
  };
}
