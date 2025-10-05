import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import supabase, {
  addVocabToPrivateList,
  removeVocabFromPrivateList,
} from "../lib/supabase";
import { Button } from "../components/ui/button";

type Vocab = {
  id: number;
  itself: string;
  owner_id?: string | null;
  created_at?: string | null;
};
type Meaning = {
  id: number;
  itself: string;
  sentences?: string[] | null;
  owner_id?: string | null;
};

export default function VocabDetail() {
  const [params] = useSearchParams();
  const idParam = params.get("id");
  const id = idParam ? Number(idParam) : NaN;

  const [vocab, setVocab] = useState<Vocab | null>(null);
  const [meanings, setMeanings] = useState<Meaning[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setMessage(null);
      try {
        if (!id || Number.isNaN(id)) {
          setMessage("Invalid vocab id");
          setVocab(null);
          setMeanings([]);
          return;
        }
        const { data: vRes, error: vErr } = await supabase
          .from("vocabs")
          .select("id,itself,owner_id,created_at")
          .eq("id", id)
          .maybeSingle();
        if (vErr) throw vErr;
        if (!mounted) return;
        setVocab(vRes ?? null);

        const { data: mRes, error: mErr } = await supabase
          .from("meanings")
          .select("id,itself,sentences,owner_id")
          .eq("vocab_id", id)
          .order("id", { ascending: true })
          .limit(50);
        if (mErr) throw mErr;
        if (!mounted) return;
        setMeanings((mRes || []) as Meaning[]);
      } catch (err: any) {
        setMessage(err?.message || String(err));
        setVocab(null);
        setMeanings([]);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  async function handleSave() {
    setMessage(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) {
        setMessage("Sign in to save to your private list.");
        return;
      }
      const res = await addVocabToPrivateList(userId, id);
      if (res?.error) {
        setMessage("Could not save (server rejection).");
        return;
      }
      setMessage("Saved to your private list.");
    } catch (err: any) {
      setMessage(err?.message || String(err));
    }
  }

  async function handleRemoveFromPrivate() {
    setMessage(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) {
        setMessage("Sign in to remove.");
        return;
      }
      const removeAll = window.confirm(
        "Remove all occurrences and owned meanings?\n\nOK = remove all occurrences\nCancel = remove from this list only"
      );
      const res = await removeVocabFromPrivateList(userId, id, removeAll);
      if (res?.error) {
        setMessage("Operation partially failed (server rejection).");
        return;
      }
      setMessage("Removed (attempted).");
    } catch (err: any) {
      setMessage(err?.message || String(err));
    }
  }

  if (loading) return <div className="p-6 text-sm">Loading...</div>;

  if (!vocab)
    return (
      <div className="p-6 text-sm text-red-600">
        {message ?? "Vocab not found."}
      </div>
    );

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-2">{vocab.itself}</h1>
      <div className="text-xs text-muted-foreground mb-4">
        Added: {vocab.created_at ?? "unknown"}
      </div>
      {message && (
        <div className="mb-4 text-sm text-muted-foreground">{message}</div>
      )}

      <div className="flex gap-2 mb-4">
        <Button size="sm" variant="outline" onClick={handleSave}>
          Save to private list
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={handleRemoveFromPrivate}
        >
          Remove
        </Button>
        <Button size="sm" asChild>
          <Link to={`/profile?id=${vocab.owner_id}`}>Owner profile</Link>
        </Button>
      </div>

      <div className="border-t pt-4">
        <h2 className="font-semibold mb-2">Meanings</h2>
        {meanings.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No meanings found.
          </div>
        ) : (
          <ul className="space-y-3">
            {meanings.map((m) => (
              <li key={m.id} className="rounded-md border p-3">
                <div className="font-medium">{m.itself}</div>
                {m.sentences && m.sentences.length > 0 && (
                  <div className="mt-2 text-sm text-muted-foreground">
                    {m.sentences.map((s, i) => (
                      <div key={i}>• {s}</div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
