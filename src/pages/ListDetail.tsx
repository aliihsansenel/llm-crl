import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import supabase from "../lib/supabase";
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
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  // for owner editing and list type
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [descInput, setDescInput] = useState<string | undefined | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);

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

        setIsPrivate(privateFlag);
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
          const ids = (idsRes || []).map((r: any) => r.vocab_id);
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

        // Fallback: if resolved as public list but no items found and the viewer is the owner,
        // attempt to load the viewer's private list items (they may be stored in p_vocab_list_items).
        if (
          (!loaded || loaded.length === 0) &&
          resolvedList &&
          resolvedList.owner_id
        ) {
          const { data: authRes } = await supabase.auth.getUser();
          const viewerId = authRes?.user?.id ?? null;
          if (viewerId && viewerId === resolvedList.owner_id) {
            // try to find the user's private list
            const { data: pListByOwner } = await supabase
              .from("p_vocab_lists")
              .select("id")
              .eq("owner_id", viewerId)
              .limit(1)
              .maybeSingle();
            const pId = pListByOwner?.id;
            if (pId) {
              const pItems = await loadVocabsForList(pId, true);
              if (pItems.length > 0) {
                loaded = pItems;
                setIsPrivate(true);
                // reflect that we are effectively showing the private list
                setList((prev) =>
                  prev
                    ? {
                        ...prev,
                        id: pId,
                        name: "Private list",
                        owner_id: viewerId,
                      }
                    : prev
                );
              }
            }
          }
        }

        setItems(loaded);

        // check subscription status if user signed in
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const userId = user?.id;
        // store current user id for ownership checks and later operations
        setCurrentUserId(userId ?? null);
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
        setMessage(
          typeof err === "object" && err && "message" in err
            ? (err as any).message
            : String(err)
        );
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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
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
      setMessage(
        typeof err === "object" && err && "message" in err
          ? (err as any).message
          : String(err)
      );
    }
  }

  async function handleAddToList(vocabId: number) {
    setMessage(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) {
        setMessage("Sign in to add items to lists.");
        return;
      }
      const res = await supabase
        .from("vocab_list_items")
        .insert({ vocab_list_id: id, vocab_id: vocabId });
      if (res.error) {
        // ignore duplicate errors gracefully
        if (
          res.error.code === "23505" ||
          /unique/i.test(res.error.message || "")
        ) {
          setMessage("Item already in list.");
        } else {
          setMessage("Could not add item to list.");
        }
        return;
      }
      // fetch the vocab row and prepend to items
      const { data: vRes, error: vErr } = await supabase
        .from("vocabs")
        .select("id,itself")
        .eq("id", vocabId)
        .maybeSingle();
      if (!vErr && vRes) {
        setItems((s) => [vRes as Vocab, ...s].slice(0, 20));
      }
      setMessage("Added to list.");
    } catch (err: unknown) {
      setMessage(String(err));
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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
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
      setMessage(
        typeof err === "object" && err && "message" in err
          ? (err as any).message
          : String(err)
      );
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

      <div className="border-t pt-4">
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
                      variant="outline"
                      onClick={() => handleAddToList(v.id)}
                    >
                      Add
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
    </div>
  );
}
