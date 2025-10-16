import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import supabase, {
  getCachedUserId,
  getPrivateRlListId,
  addRlItemToPrivateList,
} from "../lib/supabase";

type RlItem = {
  id: number;
  title?: string | null;
  created_at?: string | null;
  owner_id?: string | null;
  delete_requested?: boolean | null;
  l_item_id?: string | null;
};

// Module-level singleflight caches to dedupe network requests across renders
const rlItemsPromises: Map<
  string,
  Promise<{ data: RlItem[] | null; error: unknown | null }>
> = new Map();

const privateLoadPromises: Map<string, Promise<void>> = new Map();

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

      const key = `${userId}:${page}`;
      if (privateLoadPromises.has(key)) {
        await privateLoadPromises.get(key);
        return;
      }

      const p = (async () => {
        try {
          const listId = await getPrivateRlListId(userId);
          if (!listId) {
            setItems([]);
            setLoading(false);
            setTotal(0);
            return;
          }

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

          const idsKey = ids
            .slice()
            .sort((a, b) => a - b)
            .join(",");
          let rlRes = undefined as
            | { data: RlItem[] | null; error: unknown | null }
            | undefined;
          if (rlItemsPromises.has(idsKey)) {
            rlRes = await rlItemsPromises.get(idsKey);
          } else {
            const fetchRl = (async () => {
              const { data, error } = await supabase
                .from("rl_items")
                .select(
                  "id,title,created_at,owner_id,delete_requested,l_item_id"
                )
                .in("id", ids);
              if (error) throw error;
              return { data, error: null } as {
                data: RlItem[] | null;
                error: unknown | null;
              };
            })();
            rlItemsPromises.set(idsKey, fetchRl);
            try {
              rlRes = await fetchRl;
            } finally {
              rlItemsPromises.delete(idsKey);
            }
          }

          if (!rlRes) {
            rlRes = { data: [], error: null };
          }

          const map = new Map<number, RlItem>();
          (rlRes.data || []).forEach((r) => map.set(r.id, r));
          const ordered = ids
            .map((id) => map.get(id))
            .filter(Boolean) as RlItem[];

          setItems(ordered);
          setTotal(count ?? ordered.length);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : String(err));
          setItems([]);
          setTotal(0);
        } finally {
          setLoading(false);
        }
      })();

      privateLoadPromises.set(key, p);
      try {
        await p;
      } finally {
        privateLoadPromises.delete(key);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
      setTotal(0);
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

      const addRes = await addRlItemToPrivateList(userId, rlItemId);
      if (addRes.error) {
        console.warn("failed to add rl_item to private list", addRes.error);
      }

      navigate(`/rl-items?id=${rlItemId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

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

      const listId = await getPrivateRlListId(userId);
      if (!listId) {
        setError("Private list not found.");
        return;
      }

      const delRes = await supabase
        .from("p_rl_list_items")
        .delete()
        .match({ p_rl_list_id: listId, rl_item_id: itemId });
      if (delRes.error) {
        throw delRes.error;
      }

      setItems((prev) => prev.filter((it) => it.id !== itemId));

      if (ownerId === userId && !lItemId) {
        const del = await supabase
          .from("rl_items")
          .delete()
          .match({ id: itemId });
        if (del.error) {
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
