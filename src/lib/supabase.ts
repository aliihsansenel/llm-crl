// src/lib/supabase.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

// Minimal JSON type helper
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

// Database types (partial, only tables used by frontend)
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          user_id: string;
          username: string;
          first_name?: string | null;
          last_name?: string | null;
          bio?: string | null;
        };
        Insert: {
          user_id: string;
          username: string;
          first_name?: string | null;
          last_name?: string | null;
          bio?: string | null;
        };
        Update: {
          username?: string;
          first_name?: string | null;
          last_name?: string | null;
          bio?: string | null;
        };
      };
      settings: {
        Row: {
          user_id: string;
          level_id?: number | null;
          auto_confirm_1: boolean;
          auto_confirm_2: boolean;
        };
        Insert: {
          user_id: string;
          level_id?: number | null;
          auto_confirm_1?: boolean;
          auto_confirm_2?: boolean;
        };
        Update: {
          level_id?: number | null;
          auto_confirm_1?: boolean;
          auto_confirm_2?: boolean;
        };
      };
      p_vocab_lists: {
        Row: {
          id: number;
          owner_id?: string | null;
          created_at: string;
          modified_at?: string | null;
        };
        Insert: {
          owner_id?: string | null;
        };
        Update: {
          owner_id?: string | null;
        };
      };
      p_vocab_list_items: {
        Row: {
          p_vocab_list_id: number;
          vocab_id: number;
        };
        Insert: {
          p_vocab_list_id: number;
          vocab_id: number;
        };
        Update: Record<string, never>;
      };
      vocabs: {
        Row: {
          id: number;
          itself: string;
          created_at?: string | null;
          owner_id?: string | null;
        };
        Insert: {
          itself: string;
          owner_id?: string | null;
        };
        Update: {
          itself?: string;
        };
      };
      meanings: {
        Row: {
          id: number;
          vocab_id: number;
          itself: string;
          sentences?: string[] | null;
          owner_id?: string | null;
        };
        Insert: {
          vocab_id: number;
          itself: string;
          sentences?: string[] | null;
          owner_id?: string | null;
        };
        Update: {
          itself?: string;
          sentences?: string[] | null;
        };
      };
      vocab_lists: {
        Row: {
          id: number;
          name: string;
          desc?: string | null;
          owner_id?: string | null;
          created_at: string;
          modified_at?: string | null;
        };
        Insert: {
          name?: string;
          desc?: string | null;
          owner_id?: string | null;
        };
        Update: {
          name?: string;
          desc?: string | null;
        };
      };
      vocab_list_items: {
        Row: {
          vocab_list_id: number;
          vocab_id: number;
        };
        Insert: {
          vocab_list_id: number;
          vocab_id: number;
        };
        Update: Record<string, never>;
      };
      vocab_lists_sub: {
        Row: {
          user_id: string;
          vocab_list_id: number;
        };
        Insert: {
          user_id: string;
          vocab_list_id: number;
        };
        Update: Record<string, never>;
      };
      tokens: {
        Row: {
          user_id: string;
          free: number;
          paid: number;
          free_renewal_date: string;
        };
        Insert: {
          user_id: string;
          free?: number;
          paid?: number;
          free_renewal_date?: string;
        };
        Update: {
          free?: number;
          paid?: number;
          free_renewal_date?: string;
        };
      };
      admins: {
        Row: {
          user_id: string;
        };
        Insert: {
          user_id: string;
        };
        Update: Record<string, never>;
      };
      levels: {
        Row: {
          id: number;
          itself: string;
        };
        Insert: {
          id: number;
          itself: string;
        };
        Update: {
          itself?: string;
        };
      };
    };
  };
}

// Create client
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env
  .VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY is not set"
  );
}

export const supabase = createClient<any>(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseClient = supabase;

/**
 * Lightweight cached user-id helper
 * - avoids calling supabase.auth.getUser repeatedly across components
 * - keeps the cache in sync with auth state changes
 */
let cachedUserId: string | null = null;
let getUserPromise: Promise<string | null> | null = null;

/**
 * Do not eagerly call supabase.auth.getUser on module load (avoids duplicate requests in React Strict Mode).
 * Keep cache in sync with auth state changes.
 */
supabase.auth.onAuthStateChange((_event, session) => {
  cachedUserId = session?.user?.id ?? null;
});

/**
 * Get cached user id if available; otherwise fetch and populate cache.
 * Serializes concurrent fetches to avoid duplicated network requests.
 */
export async function getCachedUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;
  if (getUserPromise) return getUserPromise;

  getUserPromise = (async () => {
    try {
      const { data } = await supabase.auth.getUser();
      cachedUserId = data?.user?.id ?? null;
      return cachedUserId;
    } catch {
      return null;
    } finally {
      getUserPromise = null;
    }
  })();

  return getUserPromise;
}

/**
 * Cached access-token helper
 * - avoids calling supabase.auth.getSession repeatedly across components
 * - serializes concurrent fetches and keeps cache in sync with auth state changes
 */
let cachedSessionToken: string | null = null;
let getSessionTokenPromise: Promise<string | null> | null = null;

supabase.auth.onAuthStateChange((_event, session) => {
  // Keep cached user id and session token in sync with auth state
  cachedUserId = session?.user?.id ?? null;
  // The session parameter shape can vary between SDK versions; handle both possibilities
  //  - session?.access_token
  //  - session?.session?.access_token
  //  - if neither present, clear token
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = session as any;
  cachedSessionToken = s?.access_token ?? s?.session?.access_token ?? null;
});

/**
 * Return a cached access token (JWT) if available; otherwise fetch and populate cache.
 * Serializes concurrent fetches to avoid duplicated network requests.
 */
export async function getCachedSessionAccessToken(): Promise<string | null> {
  if (cachedSessionToken) return cachedSessionToken;
  if (getSessionTokenPromise) return getSessionTokenPromise;

  getSessionTokenPromise = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      // supabase.auth.getSession() may return shape { data: { session: { access_token } } }
      // or { data: { access_token } } depending on SDK. Handle both.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const token =
        (data as any)?.session?.access_token ??
        (data as any)?.access_token ??
        null;
      cachedSessionToken = token ?? null;
      return cachedSessionToken;
    } catch {
      return null;
    } finally {
      getSessionTokenPromise = null;
    }
  })();

  return getSessionTokenPromise;
}

// Auth helpers
export async function signUpWithEmail(email: string, password: string) {
  return await supabase.auth.signUp({ email, password });
}

export async function signInWithEmail(email: string, password: string) {
  return await supabase.auth.signInWithPassword({ email, password });
}

/**
 * Sign in / Sign up with Google (OAuth)
 * Supabase treats OAuth sign-in and sign-up via the same endpoint.
 * Redirects back to the provided redirect URL (default: /vocabs).
 */
export async function signInWithGoogle(redirectTo?: string) {
  const redirect =
    redirectTo ??
    (typeof window !== "undefined"
      ? `${window.location.origin}/vocabs`
      : undefined);
  // supabase.auth.signInWithOAuth will trigger an OAuth redirect flow.
  return await supabase.auth.signInWithOAuth({
    provider: "google",
    options: redirect ? { redirectTo: redirect } : undefined,
  } as any);
}

export async function signOut() {
  return await supabase.auth.signOut();
}

export async function getCurrentUser() {
  return await supabase.auth.getUser();
}

export function onAuthStateChange(
  cb: (event: AuthChangeEvent, session: Session | null) => void
) {
  return supabase.auth.onAuthStateChange(cb);
}

// Lightweight cache + singleflight for private list id lookups (prevents duplicate p_vocab_lists queries)
const cachedPrivateVocabListIds = new Map<string, number>();
const privateListPromises = new Map<string, Promise<number | null>>();

export async function getPrivateVocabListId(
  userId: string
): Promise<number | null> {
  // fast path
  if (cachedPrivateVocabListIds.has(userId)) {
    return cachedPrivateVocabListIds.get(userId)!;
  }
  if (privateListPromises.has(userId)) {
    return privateListPromises.get(userId)!;
  }

  const p = (async () => {
    try {
      const { data } = await supabase
        .from("p_vocab_lists")
        .select("id")
        .eq("owner_id", userId)
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        cachedPrivateVocabListIds.set(userId, data.id);
        return data.id;
      }
      const insertRes = await supabase
        .from("p_vocab_lists")
        .insert({ owner_id: userId })
        .select("id")
        .maybeSingle();
      if (insertRes.error || !insertRes.data) {
        return null;
      }
      const id = insertRes.data.id;
      cachedPrivateVocabListIds.set(userId, id);
      return id;
    } catch {
      return null;
    } finally {
      privateListPromises.delete(userId);
    }
  })();

  privateListPromises.set(userId, p);
  return p;
}

// Ensure user has profile and settings (keep lightweight; private list creation handled via getPrivateVocabListId to avoid duplicate queries)
export async function ensureUserResources(userId: string) {
  const errors: Array<{ table: string; error: unknown }> = [];

  // profiles: upsert if not exists
  try {
    await supabase
      .from("profiles")
      .insert({ user_id: userId, username: `user_${userId.slice(0, 8)}` });
  } catch (err) {
    errors.push({ table: "profiles", error: err });
  }

  // settings: upsert default settings
  try {
    await supabase.from("settings").upsert({
      user_id: userId,
      auto_confirm_1: false,
      auto_confirm_2: false,
    });
  } catch (err) {
    errors.push({ table: "settings", error: err });
  }

  return { ok: errors.length === 0, errors };
}

// Helper: add vocab to user's private list (creates p_vocab_list if missing)
export async function addVocabToPrivateList(userId: string, vocabId: number) {
  const listId = await getPrivateVocabListId(userId);
  if (!listId) {
    return { error: new Error("failed to get or create private list") };
  }

  // insert item (ignore conflict)
  const res = await supabase
    .from("p_vocab_list_items")
    .insert({ p_vocab_list_id: listId, vocab_id: vocabId })
    .select()
    .maybeSingle();

  if (res.error) {
    return { error: res.error };
  }
  return { data: res.data };
}

// Lightweight cache + singleflight for private rl list id lookups (prevents duplicate p_rl_lists queries)
const cachedPrivateRlListIds = new Map<string, number>();
const privateRlListPromises = new Map<string, Promise<number | null>>();

export async function getPrivateRlListId(
  userId: string
): Promise<number | null> {
  // fast path
  if (cachedPrivateRlListIds.has(userId)) {
    return cachedPrivateRlListIds.get(userId)!;
  }
  if (privateRlListPromises.has(userId)) {
    return privateRlListPromises.get(userId)!;
  }

  const p = (async () => {
    try {
      const { data } = await supabase
        .from("p_rl_lists")
        .select("id")
        .eq("owner_id", userId)
        .limit(1)
        .maybeSingle();
      if (data?.id) {
        cachedPrivateRlListIds.set(userId, data.id);
        return data.id;
      }
      const insertRes = await supabase
        .from("p_rl_lists")
        .insert({ owner_id: userId })
        .select("id")
        .maybeSingle();
      if (insertRes.error || !insertRes.data) {
        return null;
      }
      const id = insertRes.data.id;
      cachedPrivateRlListIds.set(userId, id);
      return id;
    } catch {
      return null;
    } finally {
      privateRlListPromises.delete(userId);
    }
  })();

  privateRlListPromises.set(userId, p);
  return p;
}

// Helper: add rl_item to user's private rl list (creates p_rl_list if missing)
export async function addRlItemToPrivateList(userId: string, rlItemId: number) {
  const listId = await getPrivateRlListId(userId);
  if (!listId) {
    return { error: new Error("failed to get or create private rl list") };
  }

  // insert item into private rl list
  const res = await supabase
    .from("p_rl_list_items")
    .insert({ p_rl_list_id: listId, rl_item_id: rlItemId })
    .select()
    .maybeSingle();

  if (res.error) {
    return { error: res.error };
  }
  return { data: res.data };
}

export async function removeRlItemFromPrivateList(
  userId: string,
  rlItemId: number
) {
  const listId = await getPrivateRlListId(userId);
  if (!listId) {
    return { error: new Error("private rl list not found") };
  }

  const res = await supabase
    .from("p_rl_list_items")
    .delete()
    .match({ p_rl_list_id: listId, rl_item_id: rlItemId });

  if (res.error) {
    return { error: res.error };
  }

  return { ok: true };
}

// Helper: create a new global vocab (owned by user) and add it into user's private list
export async function createVocabAndAddToPrivateList(
  userId: string,
  itself: string
) {
  // attempt to create vocab with owner set to user
  const insertRes = await supabase
    .from("vocabs")
    .insert({ itself, owner_id: userId })
    .select("id")
    .maybeSingle();

  // If insert succeeded, proceed to add to private list
  if (!insertRes.error && insertRes.data) {
    const vocabId = insertRes.data.id;
    const addRes = await addVocabToPrivateList(userId, vocabId);
    if (addRes.error) {
      // non-fatal in UX, but return error info so caller can decide how to inform user
      return { error: addRes.error, vocabId };
    }
    return { data: { vocabId, added: addRes.data } };
  }

  // If insert failed, check if it's a conflict (duplicate) and attempt to find existing vocab by text
  const err = insertRes.error as any;
  const isConflict =
    err &&
    (err.code === "23505" ||
      err.status === 409 ||
      /duplicate/i.test(String(err.message || "")));

  if (isConflict) {
    try {
      const { data: existing, error: findErr } = await supabase
        .from("vocabs")
        .select("id")
        .eq("itself", itself)
        .limit(1)
        .maybeSingle();

      if (findErr || !existing) {
        // fallback to returning original insert error if lookup fails
        return { error: insertRes.error || findErr };
      }

      const vocabId = existing.id;
      const addRes = await addVocabToPrivateList(userId, vocabId);
      if (addRes.error) {
        return { error: addRes.error, vocabId };
      }
      return { data: { vocabId, added: addRes.data } };
    } catch (lookupErr) {
      return { error: lookupErr };
    }
  }

  // For other errors, return the insert error
  return { error: insertRes.error || new Error("failed to create vocab") };
}

// Helper: remove vocab from private list or delete all occurrences + attempt to delete vocab and owned meanings per business rules
export async function removeVocabFromPrivateList(
  userId: string,
  vocabId: number,
  removeAllOccurrences = false
) {
  const listId = await getPrivateVocabListId(userId);
  if (!listId) {
    return { error: new Error("private list not found") };
  }

  // remove from this list
  const deleteRes = await supabaseClient
    .from("p_vocab_list_items")
    .delete()
    .match({ p_vocab_list_id: listId, vocab_id: vocabId });

  if (deleteRes.error) {
    return { error: deleteRes.error };
  }

  if (removeAllOccurrences) {
    // remove from owned vocab_list_items where owner is this user: this requires a join; do a client-side approach:
    // fetch vocab_lists owned by user
    const listsRes = await supabase
      .from("vocab_lists")
      .select("id")
      .eq("owner_id", userId);
    if (listsRes.error) {
      return { error: listsRes.error };
    }
    const ownedListIds = (listsRes.data || []).map((r: { id: number }) => r.id);
    if (ownedListIds.length) {
      const removePublicItemsRes = await supabase
        .from("vocab_list_items")
        .delete()
        .in("vocab_list_id", ownedListIds)
        .match({ vocab_id: vocabId });
      if (removePublicItemsRes.error) {
        // non-fatal: collect error but continue
        console.warn(
          "failed to remove from owned lists",
          removePublicItemsRes.error
        );
      }
    }

    // delete owned meanings attached to this vocab
    const deleteMeaningsRes = await supabase
      .from("meanings")
      .delete()
      .match({ vocab_id: vocabId, owner_id: userId });
    if (deleteMeaningsRes.error) {
      console.warn("failed to delete owned meanings", deleteMeaningsRes.error);
    }
  }

  // finally attempt to delete vocab itself; supabase may reject if others use it — treat rejection as non-fatal per instructions
  const delVocab = await supabase
    .from("vocabs")
    .delete()
    .match({ id: vocabId, owner_id: userId });
  if (delVocab.error) {
    // ignore deletion errors related to foreign key usage; log and return success status
    console.warn("delete vocab attempt rejected", delVocab.error);
    return {
      ok: true,
      note: "vocab deletion rejected by server - likely in use by others",
    };
  }

  return { ok: true };
}

// Export supabase type for consumers
export type Supabase = SupabaseClient<any>;

export default supabase;
