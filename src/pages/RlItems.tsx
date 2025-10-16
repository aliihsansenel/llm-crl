import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import supabase, {
  ensureUserResources,
  getCachedUserId,
} from "../lib/supabase";

type RlItem = {
  id: number;
  title?: string | null;
  created_at?: string | null;
  owner_id?: string | null;
  delete_requested?: boolean | null;
  l_item_id?: string | null;
};

export default function RlItemsPage() {
  const PAGE_SIZE = 20;

  const [items, setItems] = useState<RlItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const navigate = useNavigate();

  async function loadPrivateRlItems() {
    setLoading(true);
    setError(null);
    try {
      const userId = await getCachedUserId();
      if (!userId) {
        setError("You must be signed in to view your content.");
        setItems([]);
        setLoading(false);
        return;
      }

      await ensureUserResources(userId);

      const { data: pList } = await supabase
        .from("p_rl_lists")
        .select("id")
        .eq("owner_id", userId)
        .limit(1)
        .maybeSingle();

      const listId = pList?.id;
      if (!listId) {
        setItems([]);
        setLoading(false);
        setTotal(0);
        return;
      }

      // paginate p_rl_list_items
      const start = page * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;
      const {
        data: itemsRes,
        error: itemsErr,
        count,
      } = await supabase
        .from("p_rl_list_items")
        .select("rl_item_id", { count: "exact" })
        .eq("p_rl_list_id", listId)
        .order("added_at", { ascending: false })
        .range(start, end);

      if (itemsErr) throw itemsErr;

      const ids: number[] = (itemsRes || []).map(
        (r: { rl_item_id: number }) => r.rl_item_id
      );
      if (!ids.length) {
        setItems([]);
        setTotal(count ?? 0);
        setLoading(false);
        return;
      }

      const { data: rlRes, error: rlErr } = await supabase
        .from("rl_items")
        .select("id,title,created_at,owner_id,delete_requested,l_item_id")
        .in("id", ids);
      if (rlErr) throw rlErr;

      const map = new Map<number, RlItem>();
      ((rlRes || []) as RlItem[]).forEach((r) => map.set(r.id, r));
      const ordered = ids.map((id) => map.get(id)).filter(Boolean) as RlItem[];

      setItems(ordered);
      setTotal(count ?? ordered.length);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateNew() {
    setError(null);
    setCreating(true);
    try {
      const userId = await getCachedUserId();
      if (!userId) {
        setError("You must be signed in to create content.");
        setCreating(false);
        return;
      }

      // insert rl_item with owner_id
      const insertRes = await supabase
        .from("rl_items")
        .insert({ owner_id: userId })
        .select("id")
        .maybeSingle();

      if (insertRes.error || !insertRes.data) {
        setError(insertRes.error?.message || "Failed to create reading item.");
        setCreating(false);
        return;
      }
      const rlItemId: number = insertRes.data.id;

      // ensure private rl list exists and add to it
      const { data: pList } = await supabase
        .from("p_rl_lists")
        .select("id")
        .eq("owner_id", userId)
        .limit(1)
        .maybeSingle();

      let listId: number | undefined = pList?.id;
      if (!listId) {
        const createRes = await supabase
          .from("p_rl_lists")
          .insert({ owner_id: userId })
          .select("id")
          .maybeSingle();
        if (createRes.error || !createRes.data) {
          setError("Failed to create private list.");
          setCreating(false);
          return;
        }
        listId = createRes.data.id;
      }

      // add to private list
      const addRes = await supabase
        .from("p_rl_list_items")
        .insert({ p_rl_list_id: listId, rl_item_id: rlItemId });
      if (addRes.error) {
        // non-fatal: proceed but inform user via console
        console.warn("failed to add rl_item to private list", addRes.error);
      }

      // navigate to detail page
      navigate(`/rl-items?id=${rlItemId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  // Remove an rl_item from the user's private list and attempt to delete the rl_item itself
  async function handleRemoveFromPrivateAndMaybeDelete(
    itemId: number,
    ownerId?: string | null,
    lItemId?: string | null
  ) {
    setError(null);
    try {
      const userId = await getCachedUserId();
      if (!userId) {
        setError("You must be signed in to remove items.");
        return;
      }

      // find user's private rl list
      const { data: pList } = await supabase
        .from("p_rl_lists")
        .select("id")
        .eq("owner_id", userId)
        .limit(1)
        .maybeSingle();
      const listId = pList?.id;
      if (!listId) {
        setError("Private list not found.");
        return;
      }

      // remove the item from the private list
      const delRes = await supabase
        .from("p_rl_list_items")
        .delete()
        .match({ p_rl_list_id: listId, rl_item_id: itemId });
      if (delRes.error) {
        throw delRes.error;
      }

      // optimistically remove from UI
      setItems((prev) => prev.filter((it) => it.id !== itemId));

      // if the current user is the owner and there is no l_item_id, attempt to delete rl_item
      if (ownerId === userId && !lItemId) {
        const del = await supabase
          .from("rl_items")
          .delete()
          .match({ id: itemId });
        if (del.error) {
          // if deletion rejected, set delete_requested = true
          const upd = await supabase
            .from("rl_items")
            .update({ delete_requested: true })
            .match({ id: itemId });
          if (upd.error) {
            console.warn(
              "failed to request delete after delete rejection",
              upd.error
            );
          }
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    loadPrivateRlItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  if (loading) return <div className="p-6 text-sm">Loading...</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">
          My Reading/Listening (Private)
        </h1>
        <div>
          <Button onClick={handleCreateNew} size="sm" disabled={creating}>
            {creating ? "Creating..." : "New"}
          </Button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

      {!items.length ? (
        <div className="text-sm text-muted-foreground">
          No reading/listening items yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <div className="flex flex-col">
                <div className="text-sm font-medium">
                  {it.title ?? "Unnamed Content"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {it.created_at ?? ""}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" asChild>
                  <Link to={`/rl-items?id=${it.id}`}>Details</Link>
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() =>
                    handleRemoveFromPrivateAndMaybeDelete(
                      it.id,
                      it.owner_id,
                      it.l_item_id
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination controls */}
      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Prev
          </Button>
          <Button
            size="sm"
            onClick={() =>
              setPage((p) =>
                (p + 1) * PAGE_SIZE < total
                  ? Math.min(p + 1, Math.ceil(total / PAGE_SIZE) - 1)
                  : p
              )
            }
            disabled={(page + 1) * PAGE_SIZE >= total}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
