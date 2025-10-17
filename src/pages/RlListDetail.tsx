import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import supabase, {
  getCachedUserId,
  ensureUserResources,
} from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Alert, AlertDescription } from "../components/ui/alert";

type RlItem = {
  id: number;
  title?: string | null;
  owner_id?: string | null;
  created_at?: string | null;
  l_item_id?: string | null;
  delete_requested?: boolean | null;
};

type RlList = {
  id: number;
  name?: string | null;
  desc?: string | null;
  owner_id?: string | null;
  created_at?: string | null;
};

function errToMessage(err: unknown): string {
  if (!err) return String(err);
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const e = err as { message?: unknown };
    if (typeof e.message === "string") return e.message;
  }
  return String(err);
}

export default function RlListDetail() {
  const [params] = useSearchParams();
  const idParam = params.get("id");
  const id = idParam ? Number(idParam) : NaN;

  const [list, setList] = useState<RlList | null>(null);
  const [items, setItems] = useState<RlItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  // viewer's private items (to add into this list)
  const [privateItems, setPrivateItems] = useState<RlItem[]>([]);
  const [loadingPrivate, setLoadingPrivate] = useState(false);
  const [addedFromPrivateIds, setAddedFromPrivateIds] = useState<number[]>([]);
  // whether the current list is a private p_rl_lists
  const [isPrivateList, setIsPrivateList] = useState(false);

  // ownership + edit states (new: mirror ListDetail behavior)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [descInput, setDescInput] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
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

        const { data: listRes, error: listErr } = await supabase
          .from("rl_lists")
          .select("id,name,desc,owner_id,created_at")
          .eq("id", id)
          .maybeSingle();
        if (listErr) throw listErr;

        let resolvedList = listRes ?? null;
        let privateFlag = false;

        if (!resolvedList) {
          const { data: pListRes, error: pErr } = await supabase
            .from("p_rl_lists")
            .select("id,owner_id,created_at")
            .eq("id", id)
            .maybeSingle();
          if (pErr) throw pErr;
          if (pListRes) {
            privateFlag = true;
            resolvedList = {
              id: pListRes.id,
              name: "Private list",
              desc: null,
              owner_id: pListRes.owner_id,
              created_at: pListRes.created_at,
            };
          }
        }

        // remember whether the resolved list is a private p_rl_lists so add action
        // and payload selection can behave correctly.
        setIsPrivateList(privateFlag);
        setList(resolvedList);

        const resolvedListId = resolvedList?.id ?? null;

        async function loadItemsForList(listId: number, privateList = false) {
          const table = privateList ? "p_rl_list_items" : "rl_list_items";
          const fk = privateList ? "p_rl_list_id" : "rl_list_id";
          const { data: idsRes, error: idsErr } = await supabase
            .from(table)
            .select("rl_item_id")
            .eq(fk, listId)
            .limit(20);
          if (idsErr) throw idsErr;
          const ids = ((idsRes || []) as { rl_item_id: number }[]).map(
            (r) => r.rl_item_id
          );
          if (!ids.length) return [] as RlItem[];
          const { data: rlRes, error: rlErr } = await supabase
            .from("rl_items")
            .select("id,title,created_at,owner_id,l_item_id,delete_requested")
            .in("id", ids.reverse())
            .limit(20)
            .order("created_at", { ascending: false });
          if (rlErr) throw rlErr;
          return (rlRes as RlItem[]) || [];
        }

        let loaded: RlItem[] = [];
        if (resolvedListId) {
          loaded = await loadItemsForList(resolvedListId, privateFlag);
        }
        setItems(loaded);

        const userId = await getCachedUserId();
        setCurrentUserId(userId ?? null);

        if (userId) {
          // load viewer's private rl items so user can add them to this list
          await loadPrivateRlItems(userId);

          const { data: subRes, error: subErr } = await supabase
            .from("rl_lists_sub")
            .select("rl_list_id")
            .match({ user_id: userId, rl_list_id: id })
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
  }, [id]);

  // Load the current viewer's private rl items (last 30)
  async function loadPrivateRlItems(userId: string) {
    setLoadingPrivate(true);
    setPrivateItems([]);
    try {
      if (!userId) return;
      // Ensure the user's personal resources exist (same pattern used in other RL pages)
      await ensureUserResources(userId);
      const { data: pListRes, error: pListErr } = await supabase
        .from("p_rl_lists")
        .select("id")
        .eq("owner_id", userId)
        .limit(1)
        .maybeSingle();
      if (pListErr) throw pListErr;
      const pId = pListRes?.id;
      if (!pId) return;
      const { data: itemsRes, error: itemsErr } = await supabase
        .from("p_rl_list_items")
        .select("rl_item_id")
        .eq("p_rl_list_id", pId)
        .order("rl_item_id", { ascending: false })
        .limit(30);
      if (itemsErr) throw itemsErr;
      const ids = ((itemsRes || []) as { rl_item_id: number }[]).map(
        (r) => r.rl_item_id
      );
      if (!ids.length) {
        setPrivateItems([]);
        return;
      }
      const { data: rlRes, error: rlErr } = await supabase
        .from("rl_items")
        .select("id,title,owner_id,created_at,l_item_id,delete_requested")
        .in("id", ids)
        .order("created_at", { ascending: false })
        .limit(30);
      if (rlErr) throw rlErr;
      setPrivateItems((rlRes as RlItem[]) || []);
    } catch (err: unknown) {
      console.warn("loadPrivateRlItems error", err);
      setPrivateItems([]);
    } finally {
      setLoadingPrivate(false);
    }
  }

  // Optimistically add a private rl_item to the current list
  async function handleOptimisticAddFromPrivate(item: RlItem) {
    setMessage(null);
    if (!list) {
      setMessage("No list selected.");
      return;
    }
    const alreadyInTop =
      items.some((it) => it.id === item.id) ||
      addedFromPrivateIds.includes(item.id);
    if (alreadyInTop) return;

    const prevItems = items;
    // optimistic UI update
    setItems((s) => [item, ...s].slice(0, 20));
    setAddedFromPrivateIds((s) => [...s, item.id]);

    try {
      const table = isPrivateList ? "p_rl_list_items" : "rl_list_items";
      const payload = isPrivateList
        ? { p_rl_list_id: list.id, rl_item_id: item.id }
        : { rl_list_id: list.id, rl_item_id: item.id };
      const res = await supabase.from(table).insert(payload);
      if (res.error) {
        // revert optimistic update
        setItems(prevItems);
        setAddedFromPrivateIds((s) => s.filter((id) => id !== item.id));
        setMessage("Failed to add item to list.");
      }
    } catch (err) {
      setItems(prevItems);
      setAddedFromPrivateIds((s) => s.filter((id) => id !== item.id));
      setMessage(String(err));
    }
  }

  async function handleRemoveFromList(itemId: number) {
    setMessage(null);
    if (!list) return;
    try {
      const table = isPrivateList ? "p_rl_list_items" : "rl_list_items";
      const payload = isPrivateList
        ? { p_rl_list_id: list.id, rl_item_id: itemId }
        : { rl_list_id: list.id, rl_item_id: itemId };
      const res = await supabase.from(table).delete().match(payload);
      if (res.error) {
        setMessage("Could not remove item.");
        return;
      }
      // remove from top list
      setItems((s) => s.filter((it) => it.id !== itemId));
      // if this item was added optimistically from the viewer's private list,
      // re-activate it in the bottom list by removing it from addedFromPrivateIds
      setAddedFromPrivateIds((s) => s.filter((id) => id !== itemId));
      setMessage("Removed from list.");
    } catch (err: unknown) {
      setMessage(errToMessage(err));
    }
  }

  async function handleSubscribe() {
    setMessage(null);
    try {
      const userId = await getCachedUserId();
      if (!userId) {
        setMessage("Sign in to subscribe to lists.");
        return;
      }
      const res = await supabase.from("rl_lists_sub").insert({
        user_id: userId,
        rl_list_id: id,
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

  async function handleUnsubscribe() {
    setMessage(null);
    try {
      const userId = await getCachedUserId();
      if (!userId) {
        setMessage("Sign in to unsubscribe.");
        return;
      }
      const res = await supabase
        .from("rl_lists_sub")
        .delete()
        .match({ user_id: userId, rl_list_id: id });
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

  // Save edits for public rl_lists
  async function saveEdits() {
    if (!list) return;
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from("rl_lists")
        .update({ name: nameInput, desc: descInput })
        .match({ id: list.id });
      if (error) {
        setMessage(error.message || "Failed to update list");
      } else {
        setList((prev) =>
          prev ? { ...prev, name: nameInput, desc: descInput } : prev
        );
        setMessage("List updated.");
        setEditing(false);
      }
    } catch (err: unknown) {
      setMessage(errToMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-sm">Loading...</div>;
  if (!list)
    return (
      <div className="p-6 text-sm text-red-600">
        {message ?? "List not found."}
      </div>
    );

  // const ownerIsCurrent = currentUserId && list.owner_id === currentUserId;

  return (
    <div className="p-6 max-w-3xl">
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
            <Button size="sm" onClick={saveEdits} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
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
                    setNameInput(list?.name ?? "");
                    setDescInput(list?.desc ?? "");
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
        <div>
          <h2 className="font-semibold mb-2">Items</h2>
          {items.length === 0 ? (
            <Alert>
              <AlertDescription>
                No items in this list.
                <div className="mt-2">
                  <Button size="sm" asChild>
                    <Link to="/rl-items">Go to My Reading/Listening</Link>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <ul className="space-y-3">
              {items.map((v) => (
                <li
                  key={v.id}
                  className="rounded-md border p-3 flex items-center justify-between"
                >
                  <div className="flex flex-col">
                    <div className="font-medium">
                      <Link
                        to={`/rl-items?id=${v.id}`}
                        className="hover:underline"
                      >
                        {v.title ?? "Unnamed Content"}
                      </Link>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {v.created_at ?? ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveFromList(v.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-2">
            Add items from your personal reading/listening list
          </h3>
          {loadingPrivate ? (
            <div className="text-sm text-muted-foreground">
              Loading personal items...
            </div>
          ) : !privateItems.length ? (
            <div className="text-sm text-muted-foreground">
              No personal items available.
            </div>
          ) : (
            <ul className="space-y-3">
              {privateItems.map((v) => {
                const already =
                  items.some((it) => it.id === v.id) ||
                  addedFromPrivateIds.includes(v.id);
                return (
                  <li
                    key={v.id}
                    className={`rounded-md border p-3 flex items-center justify-between ${already ? "opacity-30" : ""}`}
                  >
                    <div className="text-sm">
                      <Link
                        to={`/rl-items?id=${v.id}`}
                        className={`hover:underline ${already ? "pointer-events-none" : ""}`}
                      >
                        {v.title ?? "Unnamed Content"}
                      </Link>
                    </div>
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
