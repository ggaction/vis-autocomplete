// Only publishable browser configuration. Never serialize process.env wholesale.
export function publicConfig(env = process.env) {
  const url = env.SUPABASE_URL ?? '', key = env.SUPABASE_PUBLISHABLE_KEY ?? '';
  if (key.startsWith('sb_secret_')) throw new Error('Use the Supabase publishable key, never a secret key.');
  if (key && !key.startsWith('sb_publishable_')) {
    let payload; try { payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); } catch {}
    if (payload?.role !== 'anon') throw new Error('Use a publishable key or legacy anon key.');
  }
  if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url)) throw new Error('Invalid Supabase project URL.');
  return { supabaseUrl: url, supabaseKey: key, release: env.RENDER_GIT_COMMIT ?? env.APP_RELEASE ?? 'development' };
}
