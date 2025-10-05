import React, { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import supabase, {
  ensureUserResources,
  addVocabToPrivateList,
  removeVocabFromPrivateList,
} from "../lib/supabase";

type Vocab = {
  id: number;
  itself: string;
};

export default function VocabsPage() {
  const [vocabItems, setVocabItems] = useState<Vocab[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPrivateVocabs() {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) {
        setError("You must be signed in to view your vocabulary.");
        setVocabItems([]);
        setLoading(false);
        return;
      }

      // Ensure resources exist (profile / settings / private list)
      await ensureUserResources(userId);

      // Get private list id
      const { data: pList } = await supabase
        .from("p_vocab_lists")
        .select("id")
        .eq("owner_id", userId)
        .limit(1)
        .maybeSingle();

      const listId = pList?.id;
      if (!listId) {
        setVocabItems([]);
        setLoading(false);
        return;
      }

      // Get items in private list
      const { data: itemsRes, error: itemsErr } = await supabase
        .from("p_vocab_list_items")
        .select("vocab_id")
        .eq("p_vocab_list_id", listId);

      if (itemsErr) throw itemsErr;

      const ids: number[] = (itemsRes || []).map((r: any) => r.vocab_id);
      if (!ids.length) {
        setVocabItems([]);
        setLoading(false);
        return;
      }

      // Fetch vocabs
      const { data: vocabsRes, error: vocabsErr } = await supabase
        .from("vocabs")
        .select("id,itself")
        .in("id", ids);

      if (vocabsErr) throw vocabsErr;

      setVocabItems((vocabsRes as Vocab[]) || []);
    } catch (err: any) {
      setError(err?.message || String(err));
      setVocabItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPrivateVocabs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRemove(vocabId: number) {
    // Two-choice confirmation: OK => remove all occurrences, Cancel => remove from this list only
    const removeAll = window.confirm(
      "Remove all occurrences (including owned meanings and presence in your owned lists)?\n\nOK = Remove all occurrences\nCancel = Remove from this private list only"
    );

    try {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
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
      // refresh list
      await loadPrivateVocabs();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm">Loading...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">
        My Vocabulary (Private List)
      </h1>
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
    </div>
  );
}
