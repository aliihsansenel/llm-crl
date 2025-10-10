// src/pages/Lists.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../components/ui/alert-dialog";
import supabase, { getCachedUserId } from "../lib/supabase";

export default function ListsPage() {
  const [owned, setOwned] = useState<any[]>([]);
  const [subscribed, setSubscribed] = useState<any[]>([]);
  // reading/listening lists
  const [ownedRlLists, setOwnedRlLists] = useState<any[]>([]);
  const [subscribedRlLists, setSubscribedRlLists] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // track which list is being deleted and its type ("vocab" | "rl")
  const [deletingListId, setDeletingListId] = useState<number | null>(null);
  const [deletingListType, setDeletingListType] = useState<
    "vocab" | "rl" | null
  >(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // separate flag for creating RL (reading/listening) lists
  const [creatingRl, setCreatingRl] = useState(false);

  async function loadLists() {
    setLoading(true);
    setError(null);
    try {
      // use cached helper to avoid repeated auth calls
      const userId = await getCachedUserId();
      if (!userId) {
        setOwned([]);
        setSubscribed([]);
        setOwnedRlLists([]);
        setSubscribedRlLists([]);
        setLoading(false);
        setError("Sign in required");
        return;
      }

      // owned vocabulary lists
      const { data: ownedRes, error: ownedErr } = await supabase
        .from("vocab_lists")
        .select("id,name,desc,owner_id,created_at")
        .eq("owner_id", userId);
      if (ownedErr) throw ownedErr;
      setOwned(ownedRes || []);

      // subscribed vocabulary lists
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

      // owned rl_lists (reading/listening lists)
      const { data: ownedRlRes, error: ownedRlErr } = await supabase
        .from("rl_lists")
        .select("id,name,desc,owner_id,created_at")
        .eq("owner_id", userId);
      if (ownedRlErr) throw ownedRlErr;
      setOwnedRlLists(ownedRlRes || []);

      // subscribed rl lists
      const { data: subRlRes, error: subRlErr } = await supabase
        .from("rl_lists_sub")
        .select("rl_list_id")
        .eq("user_id", userId);
      if (subRlErr) throw subRlErr;
      const rlIds = (subRlRes || []).map((r: any) => r.rl_list_id);
      if (rlIds.length) {
        const { data: rlListsRes, error: rlListsErr } = await supabase
          .from("rl_lists")
          .select("id,name,desc,owner_id,created_at")
          .in("id", rlIds);
        if (rlListsErr) throw rlListsErr;
        setSubscribedRlLists(rlListsRes || []);
      } else {
        setSubscribedRlLists([]);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
      setOwned([]);
      setSubscribed([]);
      setOwnedRlLists([]);
      setSubscribedRlLists([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDelete(listId: number) {
    // Open confirmation dialog
    setDeletingListId(listId);
    setDeleteDialogOpen(true);
  }

  async function performDelete() {
    const listId = deletingListId;
    if (!listId) {
      setDeleteDialogOpen(false);
      return;
    }
    setDeleteDialogOpen(false);
    setLoading(true);
    try {
      const table = deletingListType === "rl" ? "rl_lists" : "vocab_lists";
      const { error } = await supabase
        .from(table)
        .delete()
        .match({ id: listId });
      if (error) {
        // attempt drop ownership if delete rejected by DB/RLS (only applicable to vocab_lists)
        const dropTable = table;
        const drop = await supabase
          .from(dropTable)
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
      setDeletingListId(null);
      setDeletingListType(null);
      await loadLists();
      setLoading(false);
    }
  }

  async function createList() {
    setCreating(true);
    setError(null);
    try {
      const res = await supabase
        .from("vocab_lists")
        .insert({})
        .select("id")
        .single();
      if (res.error || !res.data) {
        setError(res.error?.message || "Failed to create list");
      } else {
        const newId = res.data.id;
        // open dedicated page in new tab
        window.open(`/lists?id=${newId}`, "_blank");
      }
    } catch (err: any) {
      setError(String(err));
    } finally {
      setCreating(false);
      await loadLists();
    }
  }

  // create RL (reading/listening) list and open its dedicated page
  async function createRlList() {
    setCreatingRl(true);
    setError(null);
    try {
      const res = await supabase
        .from("rl_lists")
        .insert({})
        .select("id")
        .single();
      if (res.error || !res.data) {
        setError(
          res.error?.message || "Failed to create reading/listening list"
        );
      } else {
        const newId = res.data.id;
        window.open(`/rl-lists?id=${newId}`, "_blank");
      }
    } catch (err: any) {
      setError(String(err));
    } finally {
      setCreatingRl(false);
      await loadLists();
    }
  }

  async function handleUnsubscribe(listId: number) {
    setLoading(true);
    setError(null);
    try {
      const userId = await getCachedUserId();
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
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Owned Vocabulary Lists</h2>
              <Button size="sm" onClick={createList} disabled={creating}>
                {creating ? "Creating..." : "Create list"}
              </Button>
            </div>

            {owned.length === 0 ? (
              <div className="text-sm text-muted-foreground mt-2">
                No owned vocabulary lists
              </div>
            ) : (
              <ul className="space-y-2 mt-2">
                {owned.map((l: any) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between border p-3 rounded-md"
                  >
                    <div>
                      <a
                        href={`/lists?id=${l.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium hover:underline"
                      >
                        {l.name}
                      </a>
                      <div className="text-sm text-muted-foreground">
                        {l.desc}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDeletingListType("vocab");
                          handleDelete(l.id);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mb-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Owned Reading/Listening Lists</h2>
              <div>
                <Button size="sm" onClick={createRlList} disabled={creatingRl}>
                  {creatingRl ? "Creating..." : "Create list"}
                </Button>
              </div>
            </div>

            {ownedRlLists.length === 0 ? (
              <div className="text-sm text-muted-foreground mt-2">
                No owned reading/listening lists
              </div>
            ) : (
              <ul className="space-y-2 mt-2">
                {ownedRlLists.map((l: any) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between border p-3 rounded-md"
                  >
                    <div>
                      <a
                        href={`/rl-lists?id=${l.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium hover:underline"
                      >
                        {l.name}
                      </a>
                      <div className="text-sm text-muted-foreground">
                        {l.desc}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDeletingListType("rl");
                          handleDelete(l.id);
                        }}
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
            <h2 className="font-semibold">Subscribed Vocabulary Lists</h2>
            {subscribed.length === 0 ? (
              <div className="text-sm text-muted-foreground mt-2">
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
                      <a
                        href={`/lists?id=${l.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium hover:underline"
                      >
                        {l.name}
                      </a>
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

          <section className="mt-4">
            <h2 className="font-semibold">
              Subscribed Reading/Listening Lists
            </h2>
            {subscribedRlLists.length === 0 ? (
              <div className="text-sm text-muted-foreground mt-2">
                No subscriptions
              </div>
            ) : (
              <ul className="space-y-2 mt-2">
                {subscribedRlLists.map((l: any) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between border p-3 rounded-md"
                  >
                    <div>
                      <a
                        href={`/rl-lists?id=${l.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium hover:underline"
                      >
                        {l.name}
                      </a>
                      <div className="text-sm text-muted-foreground">
                        {l.desc}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // unsubscribe from rl list
                          (async () => {
                            const userId = await getCachedUserId();
                            if (!userId) return;
                            await supabase
                              .from("rl_lists_sub")
                              .delete()
                              .match({ user_id: userId, rl_list_id: l.id });
                            await loadLists();
                          })();
                        }}
                      >
                        Unsubscribe
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <AlertDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete list</AlertDialogTitle>
                <AlertDialogDescription>
                  Deleting this list will attempt to remove it. If other users
                  subscribed the server may reject deletion; in that case we
                  will attempt to drop ownership instead. This action cannot be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={performDelete}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
