const ACCOUNT_ID = /^[a-zA-Z\d_-]{12,128}$/;
const HOST_ID = /^[a-zA-Z\d][a-zA-Z\d_.:-]{0,127}$/;
const THREAD_ID = /^local:[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export const DISCLOSURE_KEYS = { snoozed: "snoozed-expanded", settled: "expanded" };

export function accountClient(view) {
  try {
    return view.__STATSIG__?.instance?.() ?? null;
  } catch {
    return null;
  }
}

export function accountIdentity(client) {
  try {
    // Use only the identity fields of the SDK context already initialized by the app.
    if (client?.loadingStatus !== "Ready") return null;
    const user = client.getContext().user;
    const account = user?.customIDs?.account_id;
    const workspace = user?.customIDs?.workspace_id ?? account;
    if (
      user?.custom?.auth_status !== "logged_in" ||
      ![user?.userID, account, workspace].every(id => typeof id === "string" && ACCOUNT_ID.test(id))
    ) return null;
    return JSON.stringify([user.userID, account, workspace]);
  } catch {
    return null;
  }
}

export async function storagePrefix(view, identity) {
  const bytes = new view.TextEncoder().encode(identity);
  const digest = await view.crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  // Keep the Settle 1.0 namespace so existing chats and preferences carry over.
  return `ct-settle.v1:${hash}:`;
}

export function threadKey(host, id) {
  if (typeof host !== "string" || typeof id !== "string" ||
      !HOST_ID.test(host) || !THREAD_ID.test(id)) return null;
  return JSON.stringify([host, id]);
}

function validKey(key) {
  try {
    const pair = JSON.parse(key);
    return Array.isArray(pair) && pair.length === 2 && threadKey(...pair) === key;
  } catch {
    return false;
  }
}

export function readEntry(value) {
  try {
    const entry = JSON.parse(value);
    if (typeof entry?.title !== "string" || entry.title.length > 420 ||
        typeof entry.token !== "string") return null;
    if (entry.wakeAt === undefined) return Number.isFinite(entry.at) ? entry : null;
    if (Number.isInteger(entry.wakeAt) && entry.wakeAt > 0 && entry.wakeAt <= 8.64e15) return entry;
  } catch {
    // Ignore unrecognized or damaged preferences.
  }
  return null;
}

export function readPreferences(storage, prefix) {
  const entries = new Map();
  const expanded = {};
  for (const [shelf, key] of Object.entries(DISCLOSURE_KEYS)) {
    expanded[shelf] = storage.getItem(prefix + key) === "true";
  }
  const threadPrefix = prefix + "thread:";
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(threadPrefix)) continue;
    const thread = key.slice(threadPrefix.length);
    const entry = validKey(thread) && readEntry(storage.getItem(key));
    if (entry) entries.set(thread, entry);
  }
  return { entries, expanded };
}
