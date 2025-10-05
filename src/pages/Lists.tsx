// src/pages/Lists.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import supabase from "../lib/supabase";

export default function ListsPage() {
  const [owned, setOwned] = useState<any[]>([]);
  const [subscribed, setSubscribed] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadLists() {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) {
        setOwned([]);
        setSubscribed([]);
        setLoading(false);
        setError("Sign in required");
        return;
      }

      // owned lists
      const { data: ownedRes, error: ownedErr } = await supabase
        .from("vocab_lists")
        .select("id,name,desc,owner_id,created_at")
        .eq("owner_id", userId);
      if (ownedErr) throw ownedErr;
      setOwned(ownedRes || []);

      // subscribed lists
      const { data: subRes, error: subErr } = await supabase
        .from("vocab_lists_sub")
        .select("vocab_list_id")
        .eq("user_id", userId);
      if (subErr) throw subErr;
      const ids = (subRes || []).map((r: any) => r.vocab_list_id);
      if (ids.length) {
        const { data: listsRes, error: listsErr } = await supabase
          .from("vocab_lists")
          .select("id,name,desc,owner_id,created_at")
          .in("id", ids);
        if (listsErr) throw listsErr;
        setSubscribed(listsRes || []);
      } else {
        setSubscribed([]);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
      setOwned([]);
      setSubscribed([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete(listId: number) {
    if (
      !confirm(
        "Delete this list? If other users subscribed it cannot be deleted; proceed to drop ownership if delete rejected."
      )
    )
      return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("vocab_lists")
        .delete()
        .match({ id: listId });
      if (error) {
        // attempt drop ownership if delete rejected by DB/RLS
        const drop = await supabase
          .from("vocab_lists")
          .update({ owner_id: null })
          .match({ id: listId });
        if (drop.error) {
          console.warn("drop ownership failed", drop.error);
        } else {
          console.info("ownership dropped");
        }
      }
    } catch (err: any) {
      console.warn(err);
    } finally {
      await loadLists();
      setLoading(false);
    }
  }

  async function handleSubscribe(listId: number) {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) {
        setError("Sign in required");
        return;
      }
      const res = await supabase
        .from("vocab_lists_sub")
        .insert({ user_id: userId, vocab_list_id: listId });
      if (res.error) {
        setError(res.error.message || String(res.error));
      }
    } catch (err: any) {
      setError(String(err));
    } finally {
      await loadLists();
      setLoading(false);
    }
  }

  async function handleUnsubscribe(listId: number) {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) {
        setError("Sign in required");
        return;
      }
      const res = await supabase
        .from("vocab_lists_sub")
        .delete()
        .match({ user_id: userId, vocab_list_id: listId });
      if (res.error) {
        setError(res.error.message || String(res.error));
      }
    } catch (err: any) {
      setError(String(err));
    } finally {
      await loadLists();
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Lists</h1>
      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}
      {loading ? (
        <div className="text-sm">Loading...</div>
      ) : (
        <>
          <section className="mb-6">
            <h2 className="font-semibold">Owned Lists</h2>
            {owned.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No owned lists
              </div>
            ) : (
              <ul className="space-y-2 mt-2">
                {owned.map((l: any) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between border p-3 rounded-md"
                  >
                    <div>
                      <div className="font-medium">{l.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {l.desc}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(l.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-semibold">Subscribed Lists</h2>
            {subscribed.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No subscriptions
              </div>
            ) : (
              <ul className="space-y-2 mt-2">
                {subscribed.map((l: any) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between border p-3 rounded-md"
                  >
                    <div>
                      <div className="font-medium">{l.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {l.desc}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUnsubscribe(l.id)}
                      >
                        Unsubscribe
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
