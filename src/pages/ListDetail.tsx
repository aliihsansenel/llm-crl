import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import supabase, { getCachedUserId } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Alert, AlertDescription } from "../components/ui/alert";

type Vocab = { id: number; itself: string };
type VocabList = {
  id: number;
  name: string;
  desc?: string | null;
  owner_id?: string | null;
  created_at?: string | null;
};

/**
 * Normalize unknown errors into a readable string message.
 */
function errToMessage(err: unknown): string {
  if (!err) return String(err);
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = err as any;
    if (typeof e.message === "string") return e.message;
  }
  return String(err);
}

/**
 * ListDetail
 * - Dedicated page for a public vocab_list: /lists?id={id}
 * - Shows list meta and some items, allows subscribe/unsubscribe if signed in
 */
export default function ListDetail() {
  const [params] = useSearchParams();
  const idParam = params.get("id");
  const id = idParam ? Number(idParam) : NaN;

  const [list, setList] = useState<VocabList | null>(null);
  const [items, setItems] = useState<Vocab[]>([]);
  const [privateVocabs, setPrivateVocabs] = useState<Vocab[]>([]);
  const [addedFromPrivateIds, setAddedFromPrivateIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPrivate, setLoadingPrivate] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  // for owner editing and list type
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [descInput, setDescInput] = useState<string | undefined | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * Load viewer's private vocabulary (if any) and cache locally.
   * This is separate from the current list's items and used for the
   * "Add items from your personal vocabulary list" section.
   */
  async function loadPrivateVocabs(userId: string | null) {
    setLoadingPrivate(true);
    setPrivateVocabs([]);
    try {
      if (!userId) return;
      const { data: pListRes, error: pListErr } = await supabase
        .from("p_vocab_lists")
        .select("id")
        .eq("owner_id", userId)
        .limit(1)
        .maybeSingle();
      if (pListErr) throw pListErr;
      const pId = pListRes?.id;
      if (!pId) return;
      const { data: itemsRes, error: itemsErr } = await supabase
        .from("p_vocab_list_items")
        .select("vocab_id")
        .eq("p_vocab_list_id", pId);
      if (itemsErr) throw itemsErr;
      const ids = ((itemsRes || []) as { vocab_id: number }[]).map(
        (r) => r.vocab_id
      );
      if (!ids.length) {
        setPrivateVocabs([]);
        return;
      }
      const { data: vocabsRes, error: vocErr } = await supabase
        .from("vocabs")
        .select("id,itself")
        .in("id", ids);
      if (vocErr) throw vocErr;
      setPrivateVocabs((vocabsRes as Vocab[]) || []);
    } catch (err) {
      console.warn("loadPrivateVocabs error", err);
      setPrivateVocabs([]);
    } finally {
      setLoadingPrivate(false);
    }
  }

  /**
   * Optimistically add a private vocab to the current (top) list.
   * - Immediately update UI (prepend to top list and hide Add button)
   * - Perform DB insert in background
   * - Revert UI if DB rejects
   */
  async function handleOptimisticAddFromPrivate(vocab: Vocab) {
    setMessage(null);
    if (!list) {
      setMessage("No list selected.");
      return;
    }
    const alreadyInTop =
      items.some((it) => it.id === vocab.id) ||
      addedFromPrivateIds.includes(vocab.id);
    if (alreadyInTop) return;

    const prevItems = items;
    // optimistic UI update
    setItems((s) => [vocab, ...s].slice(0, 20));
    setAddedFromPrivateIds((s) => [...s, vocab.id]);

    try {
      const res = await supabase
        .from("vocab_list_items")
        .insert({ vocab_list_id: list.id, vocab_id: vocab.id });
      if (res.error) {
        // revert optimistic update
        setItems(prevItems);
        setAddedFromPrivateIds((s) => s.filter((id) => id !== vocab.id));
        setMessage("Failed to add item to list.");
      }
    } catch (err) {
      setItems(prevItems);
      setAddedFromPrivateIds((s) => s.filter((id) => id !== vocab.id));
      setMessage(String(err));
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setMessage(null);
      try {
        if (!id || Number.isNaN(id)) {
          setMessage("Invalid list id");
          setList(null);
          setItems([]);
          setLoading(false);
          return;
        }

        // Try public vocab_lists first
        const { data: listRes, error: listErr } = await supabase
          .from("vocab_lists")
          .select("id,name,desc,owner_id,created_at")
          .eq("id", id)
          .maybeSingle();
        if (listErr) throw listErr;
        if (!mounted) return;

        let resolvedList = listRes ?? null;
        let privateFlag = false;

        // If not a public list, try private p_vocab_lists
        if (!resolvedList) {
          const { data: pListRes, error: pErr } = await supabase
            .from("p_vocab_lists")
            .select("id,owner_id,created_at")
            .eq("id", id)
            .maybeSingle();
          if (pErr) throw pErr;
          if (pListRes) {
            privateFlag = true;
            // p_vocab_lists are nameless; show a friendly label
            resolvedList = {
              id: pListRes.id,
              name: "Private list",
              desc: null,
              owner_id: pListRes.owner_id,
              created_at: pListRes.created_at,
            };
          }
        }

        setList(resolvedList);

        // fetch up to 20 items (show last added first).
        // Use the resolvedListId when available so both public and private lists are handled.
        const resolvedListId = resolvedList?.id ?? null;

        async function loadVocabsForList(listId: number, privateList = false) {
          const table = privateList ? "p_vocab_list_items" : "vocab_list_items";
          const fk = privateList ? "p_vocab_list_id" : "vocab_list_id";
          const { data: idsRes, error: idsErr } = await supabase
            .from(table)
            .select("vocab_id")
            .eq(fk, listId)
            .limit(20);
          if (idsErr) throw idsErr;
          const ids = ((idsRes || []) as { vocab_id: number }[]).map(
            (r) => r.vocab_id
          );
          if (ids.length === 0) {
            return [] as Vocab[];
          }
          const { data: vocabsRes, error: vocErr } = await supabase
            .from("vocabs")
            .select("id,itself")
            .in("id", ids.reverse())
            .limit(20);
          if (vocErr) throw vocErr;
          const vocabs = (vocabsRes || []) as Vocab[];
          const vocabsById = new Map(vocabs.map((v) => [v.id, v]));
          const ordered = ids
            .reverse()
            .map((i: number) => vocabsById.get(i))
            .filter(Boolean) as Vocab[];
          return ordered;
        }

        let loaded: Vocab[] = [];
        if (resolvedListId) {
          if (privateFlag) {
            loaded = await loadVocabsForList(resolvedListId, true);
          } else {
            loaded = await loadVocabsForList(resolvedListId, false);
          }
        }

        setItems(loaded);

        // check subscription status if user signed in
        const userId = await getCachedUserId();
        // store current user id for ownership checks and later operations
        setCurrentUserId(userId ?? null);

        // load viewer's private vocabs once we know user id (no-op for null)
        if (userId) {
          await loadPrivateVocabs(userId);
        }

        if (userId) {
          const { data: subRes, error: subErr } = await supabase
            .from("vocab_lists_sub")
            .select("vocab_list_id")
            .match({ user_id: userId, vocab_list_id: id })
            .limit(1);
          if (!subErr) {
            setSubscribed(((subRes || []).length ?? 0) > 0);
          } else {
            setSubscribed(null);
          }
        } else {
          setSubscribed(null);
        }
      } catch (err: unknown) {
        setMessage(errToMessage(err));
        setList(null);
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      // cleanup
      // eslint-disable-next-line react-hooks/exhaustive-deps
      mounted = false;
    };
  }, [id]);

  async function handleSubscribe() {
    setMessage(null);
    try {
      const userId = await getCachedUserId();
      if (!userId) {
        setMessage("Sign in to subscribe to lists.");
        return;
      }
      const res = await supabase.from("vocab_lists_sub").insert({
        user_id: userId,
        vocab_list_id: id,
      });
      if (res.error) {
        console.warn("subscribe error", res.error);
        setMessage("Could not subscribe (server rejection).");
        return;
      }
      setSubscribed(true);
      setMessage("Subscribed.");
    } catch (err: unknown) {
      setMessage(errToMessage(err));
    }
  }

  async function handleRemoveFromList(vocabId: number) {
    setMessage(null);
    try {
      const res = await supabase
        .from("vocab_list_items")
        .delete()
        .match({ vocab_list_id: id, vocab_id: vocabId });
      if (res.error) {
        setMessage("Could not remove item.");
        return;
      }
      setItems((s) => s.filter((it) => it.id !== vocabId));
      setMessage("Removed from list.");
    } catch (err: unknown) {
      setMessage(String(err));
    }
  }

  async function handleUnsubscribe() {
    setMessage(null);
    try {
      const userId = await getCachedUserId();
      if (!userId) {
        setMessage("Sign in to unsubscribe.");
        return;
      }
      const res = await supabase
        .from("vocab_lists_sub")
        .delete()
        .match({ user_id: userId, vocab_list_id: id });
      if (res.error) {
        console.warn("unsubscribe error", res.error);
        setMessage("Could not unsubscribe (server rejection).");
        return;
      }
      setSubscribed(false);
      setMessage("Unsubscribed.");
    } catch (err: unknown) {
      setMessage(errToMessage(err));
    }
  }

  if (loading) return <div className="p-6 text-sm">Loading...</div>;

  if (!list)
    return (
      <div className="p-6 text-sm text-red-600">
        {message ?? "List not found."}
      </div>
    );

  return (
    <div className="p-6 max-w-2xl">
      {editing ? (
        <div className="space-y-3 mb-4">
          <div>
            <label className="text-sm block mb-1">List name</label>
            <Input
              value={nameInput}
              onChange={(e) =>
                setNameInput((e.target as HTMLInputElement).value)
              }
              className="w-full"
            />
          </div>

          <div>
            <label className="text-sm block mb-1">Description</label>
            <Input
              value={descInput ?? ""}
              onChange={(e) =>
                setDescInput((e.target as HTMLInputElement).value)
              }
              className="w-full"
            />
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                if (!list) return;
                setSaving(true);
                setMessage(null);
                try {
                  const { error } = await supabase
                    .from("vocab_lists")
                    .update({ name: nameInput, desc: descInput })
                    .match({ id: list.id });
                  if (error) {
                    setMessage(error.message || "Failed to update list");
                  } else {
                    setList((prev) =>
                      prev
                        ? { ...prev, name: nameInput, desc: descInput }
                        : prev
                    );
                    setMessage("List updated.");
                    setEditing(false);
                  }
                } catch (err) {
                  setMessage(String(err));
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save"}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                // cancel edits
                setEditing(false);
                setNameInput(list?.name ?? "");
                setDescInput(list?.desc ?? "");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold mb-2">{list.name}</h1>
              <div className="text-xs text-muted-foreground mb-2">
                Created: {list.created_at ?? "unknown"}
              </div>
              <div className="mb-4 text-sm text-muted-foreground">
                {list.desc}
              </div>
            </div>

            {currentUserId && list.owner_id === currentUserId && (
              <div className="mt-1">
                <Button
                  size="sm"
                  onClick={() => {
                    setNameInput(list.name);
                    setDescInput(list.desc ?? "");
                    setEditing(true);
                  }}
                >
                  Edit
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      <div className="flex gap-2 mb-4">
        {subscribed ? (
          <Button size="sm" variant="outline" onClick={handleUnsubscribe}>
            Unsubscribe
          </Button>
        ) : (
          <Button size="sm" onClick={handleSubscribe}>
            Subscribe
          </Button>
        )}
        <Button size="sm" asChild>
          <Link to={`/profile?id=${list.owner_id}`}>Owner profile</Link>
        </Button>
      </div>

      <div className="border-t pt-4 space-y-6">
        {/* Top: current list items (first list) */}
        <div>
          <h2 className="font-semibold mb-2">Items</h2>
          {items.length === 0 ? (
            <Alert>
              <AlertDescription>
                No items in this list.
                <div className="mt-2">
                  <Button size="sm" asChild>
                    <Link to="/vocabs">Go to My Vocabulary</Link>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <ul className="space-y-3">
              {items.map((v, idx) => (
                <li
                  key={v.id}
                  className={`rounded-md border p-3 ${idx >= 10 ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{v.itself}</div>
                    <div className="flex gap-2">
                      <Button size="sm" asChild>
                        <Link to={`/vocabs?id=${v.id}`}>Open</Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveFromList(v.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Bottom: personal private vocabs to add */}
        <div>
          <h3 className="font-semibold mb-2">
            Add items from your personal vocabulary list
          </h3>
          {loadingPrivate ? (
            <div className="text-sm text-muted-foreground">
              Loading personal vocabulary...
            </div>
          ) : !privateVocabs.length ? (
            <div className="text-sm text-muted-foreground">
              No personal vocabulary available.
            </div>
          ) : (
            <ul className="space-y-3">
              {privateVocabs.map((v) => {
                const already =
                  items.some((it) => it.id === v.id) ||
                  addedFromPrivateIds.includes(v.id);
                return (
                  <li
                    key={v.id}
                    className={`rounded-md border p-3 flex items-center justify-between ${already ? "opacity-30" : ""}`}
                  >
                    <div className="text-sm">{v.itself}</div>
                    <div>
                      {!already ? (
                        <Button
                          size="sm"
                          onClick={() => handleOptimisticAddFromPrivate(v)}
                        >
                          Add
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
