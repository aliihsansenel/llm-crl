import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import supabase, {
  getPrivateVocabListId,
  removeVocabFromPrivateList,
  createVocabAndAddToPrivateList,
  getCachedUserId,
} from "../lib/supabase";

type Vocab = {
  id: number;
  itself: string;
};

// singleflight map to avoid duplicate loadPrivateVocabs calls for same user+page
const loadPrivateVocabsPromises = new Map<string, Promise<void>>();

export default function VocabsPage() {
  const PAGE_SIZE = 20;

  const [vocabItems, setVocabItems] = useState<Vocab[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newVocabText, setNewVocabText] = useState("");

  // pagination
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  async function handleStartAdd() {
    setError(null);
    setAdding(true);
  }

  function handleCancelAdd() {
    setAdding(false);
    setNewVocabText("");
  }

  async function handleConfirmAdd() {
    setError(null);
    const text = newVocabText.trim();
    if (!text) {
      setError("Please enter a vocabulary word.");
      return;
    }
    try {
      setLoading(true);
      const userId = await getCachedUserId();
      if (!userId) {
        setError("You must be signed in to perform this action.");
        setLoading(false);
        return;
      }
      const res = await createVocabAndAddToPrivateList(userId, text);
      if (res?.error) {
        console.warn("create/add error", res.error);
        setError("Failed to add vocabulary (see console).");
      } else {
        // success: update local state without a full re-fetch
        const vocabId = res.data?.vocabId;
        if (vocabId) {
          setVocabItems((prev) => [...prev, { id: vocabId, itself: text }]);
        } else {
          // fallback: if no id returned, attempt to minimally reload private vocabs
          await loadPrivateVocabs();
        }
        setAdding(false);
        setNewVocabText("");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function loadPrivateVocabs() {
    setError(null);
    // get user id first (do not set loading here yet — we want to avoid toggling loading multiple times if a duplicate call is deduped)
    const userId = await getCachedUserId();
    if (!userId) {
      setError("You must be signed in to view your vocabulary.");
      setVocabItems([]);
      setTotal(0);
      return;
    }

    const key = `${userId}:${page}`;
    if (loadPrivateVocabsPromises.has(key)) {
      // reuse in-flight promise to avoid duplicate network calls
      await loadPrivateVocabsPromises.get(key);
      return;
    }

    const p = (async () => {
      setLoading(true);
      try {
        // Resolve private list id (cached singleflight to avoid duplicate queries)
        const listId = await getPrivateVocabListId(userId);
        if (!listId) {
          setVocabItems([]);
          setTotal(0);
          return;
        }

        // Paginate items in private list ordered by added_at desc
        const start = page * PAGE_SIZE;
        const end = start + PAGE_SIZE - 1;
        const {
          data: itemsRes,
          error: itemsErr,
          count,
        } = await supabase
          .from("p_vocab_list_items")
          .select("vocab_id", { count: "exact" })
          .eq("p_vocab_list_id", listId)
          .order("added_at", { ascending: false })
          .range(start, end);

        if (itemsErr) throw itemsErr;

        const ids: number[] = (itemsRes || []).map(
          (r: { vocab_id: number }) => r.vocab_id
        );
        if (!ids.length) {
          setVocabItems([]);
          setTotal(count ?? 0);
          return;
        }

        // Fetch vocabs for the current page and preserve order by ids
        const { data: vocabsRes, error: vocabsErr } = await supabase
          .from("vocabs")
          .select("id,itself")
          .in("id", ids);

        if (vocabsErr) throw vocabsErr;

        const vocMap = new Map<number, Vocab>();
        ((vocabsRes || []) as Vocab[]).forEach((v) => vocMap.set(v.id, v));
        const ordered = ids
          .map((id) => vocMap.get(id))
          .filter(Boolean) as Vocab[];

        setVocabItems(ordered || []);
        setTotal(count ?? ordered.length);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setVocabItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    })();

    loadPrivateVocabsPromises.set(key, p);
    try {
      await p;
    } finally {
      loadPrivateVocabsPromises.delete(key);
    }
  }

  useEffect(() => {
    loadPrivateVocabs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function handleRemove(vocabId: number) {
    // Two-choice confirmation: OK => remove all occurrences, Cancel => remove from this list only
    const removeAll = window.confirm(
      "Remove all occurrences (including owned meanings and presence in your owned lists)?\n\nOK = Remove all occurrences\nCancel = Remove from this private list only"
    );

    try {
      setLoading(true);
      const userId = await getCachedUserId();
      if (!userId) {
        setError("You must be signed in to perform this action.");
        setLoading(false);
        return;
      }

      const res = await removeVocabFromPrivateList(userId, vocabId, removeAll);
      if (res?.error) {
        // Supabase-level rejections are handled gracefully per instructions
        console.warn("remove error", res.error);
      }
      // update local state without a full re-fetch
      setVocabItems((prev) => prev.filter((v) => v.id !== vocabId));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm">Loading...</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">My Vocabulary (Private List)</h1>
        <div>
          {!adding ? (
            <Button onClick={handleStartAdd} size="sm">
              Add New
            </Button>
          ) : null}
        </div>
      </div>
      {adding && (
        <div className="mb-4 flex items-center gap-2">
          <Input
            className="flex-1"
            value={newVocabText}
            onChange={(e) =>
              setNewVocabText((e.target as HTMLInputElement).value)
            }
            placeholder="Type new vocabulary..."
          />
          <Button size="sm" onClick={handleConfirmAdd}>
            Confirm
          </Button>
          <Button variant="outline" size="sm" onClick={handleCancelAdd}>
            Cancel
          </Button>
        </div>
      )}
      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}
      {!vocabItems.length ? (
        <div className="text-sm text-muted-foreground">
          No vocabulary saved yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {vocabItems.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded-md border p-3"
            >
              <div className="text-sm">{v.itself}</div>
              <div className="flex gap-2">
                <Button size="sm" asChild>
                  <Link to={`/vocabs?id=${v.id}`}>Details</Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRemove(v.id)}
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
