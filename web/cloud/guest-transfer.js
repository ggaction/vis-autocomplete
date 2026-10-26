// Only an explicit sign-in attempt in this tab may carry its guest draft into
// an account. No dataset, credentials or chart content enters sessionStorage.
const key = 'vis-autocomplete.guest-transfer';
export function stageGuestTransfer(user, storage = globalThis.sessionStorage, now = Date.now()) {
  if (user?.is_anonymous !== true) return;
  storage.setItem(key, JSON.stringify({ owner: user.id, time: now }));
}
export function pendingGuestTransfer(user, storage = globalThis.sessionStorage, now = Date.now()) {
  if (!user || user.is_anonymous === true) return null;
  try {
    const value = JSON.parse(storage.getItem(key));
    if (typeof value?.owner === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.owner) &&
      Number.isFinite(value.time) && value.time <= now && now - value.time < 86400000) return value;
  } catch { /* A malformed marker never opens another local draft. */ }
  return null;
}
export function clearGuestTransfer(storage = globalThis.sessionStorage) { storage.removeItem(key); }
