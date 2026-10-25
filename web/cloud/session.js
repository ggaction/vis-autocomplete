import { createAccount } from './client.js';

// The landing page and editor share one auth client and one ordered identity
// stream. Importing the editor never creates a second Supabase subscription.
let pending;
export function accountSession() {
  pending ??= (async () => {
    const listeners = new Set(), statuses = new Set();
    let state, status = '';
    const account = await createAccount({
      changed: next => {
        state = next;
        return Promise.all([...listeners].map(listener => listener(next)));
      },
      status: text => { status = text; for (const listener of statuses) listener(text); },
    });
    state = { user: account.user, profile: account.profile, recovery: account.recovery, configured: account.configured, identityChanged: true };
    return { account, get state() { return state; },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      onStatus(listener) { statuses.add(listener); listener(status); return () => statuses.delete(listener); },
    };
  })();
  return pending;
}

export async function authorizationHeaders() {
  const { account } = await accountSession();
  if (!account.user) throw new Error('Sign in to export your visualization.');
  const { data, error } = await account.client.auth.getSession();
  if (error || !data.session) throw new Error('Your session has expired. Please sign in again.');
  return { Authorization: `Bearer ${data.session.access_token}` };
}
