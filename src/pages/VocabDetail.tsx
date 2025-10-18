import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import supabase, {
  addVocabToPrivateList,
  removeVocabFromPrivateList,
  getCachedUserId,
} from "../lib/supabase";
import { Button } from "../components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../components/ui/popover";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

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

  // current user + admin state (used to show action buttons conditionally)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // Create meaning popover state
  const [newMeaningText, setNewMeaningText] = useState("");
  const [newMeaningSentences, setNewMeaningSentences] = useState("");

  // rl_items that reference this vocab via rl_item_vocabs_and_meanings
  const [rlItemsUsingVocab, setRlItemsUsingVocab] = useState<
    { id: number; title?: string | null; owner_id?: string | null }[]
  >([]);

  // whether current user already has this vocab in their private list
  const [isInPrivateList, setIsInPrivateList] = useState<boolean>(false);

  // helper to normalize unknown errors to string message
  function errToMessage(err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }

  // Per-meaning sentence creation state
  const [addingSentenceFor, setAddingSentenceFor] = useState<number | null>(
    null
  );
  const [newSentenceText, setNewSentenceText] = useState("");

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

        // fetch rl_items that reference this vocab via rl_item_vocabs_and_meanings
        try {
          const { data: rlRes, error: rlErr } = await supabase
            .from("rl_item_vocabs_and_meanings")
            .select("rl_item_id,rl_items(id,title,owner_id)")
            .eq("vocab_id", id)
            .limit(50);
          if (!rlErr && Array.isArray(rlRes)) {
            const mapped = (rlRes as unknown[])
              .map((p: unknown) => {
                const obj = p as Record<string, unknown>;
                // nested rl_items may be array or object depending on response
                let rlObj: Record<string, unknown> | undefined;
                const nested = obj["rl_items"];
                if (Array.isArray(nested)) {
                  rlObj = (nested as unknown[])[0] as
                    | Record<string, unknown>
                    | undefined;
                } else if (nested && typeof nested === "object") {
                  rlObj = nested as Record<string, unknown>;
                }
                const rlId =
                  typeof obj["rl_item_id"] === "number"
                    ? (obj["rl_item_id"] as number)
                    : Number(obj["rl_item_id"]);
                if (!rlObj) return null;
                return {
                  id: rlId,
                  title:
                    typeof rlObj["title"] === "string"
                      ? (rlObj["title"] as string)
                      : null,
                  owner_id:
                    typeof rlObj["owner_id"] === "string"
                      ? (rlObj["owner_id"] as string)
                      : null,
                } as {
                  id: number;
                  title?: string | null;
                  owner_id?: string | null;
                };
              })
              .filter(Boolean) as {
              id: number;
              title?: string | null;
              owner_id?: string | null;
            }[];
            setRlItemsUsingVocab(mapped);
          }
        } catch (e) {
          // non-fatal - log and continue
          // eslint-disable-next-line no-console
          console.warn("failed to load rl_items using vocab", e);
        }

        // load current user and admin status so we can show/hide controls
        try {
          const uid = await getCachedUserId();
          setCurrentUserId(uid);
          if (uid) {
            const { data: adminRes } = await supabase
              .from("admins")
              .select("user_id")
              .eq("user_id", uid)
              .maybeSingle();
            setIsAdmin(!!adminRes);

            // check if this vocab is already present in user's private list
            try {
              const { data: pList } = await supabase
                .from("p_vocab_lists")
                .select("id")
                .eq("owner_id", uid)
                .limit(1)
                .maybeSingle();
              const listId = pList?.id;
              if (listId) {
                const { data: item } = await supabase
                  .from("p_vocab_list_items")
                  .select("vocab_id")
                  .eq("p_vocab_list_id", listId)
                  .eq("vocab_id", id)
                  .maybeSingle();
                setIsInPrivateList(!!item);
              } else {
                setIsInPrivateList(false);
              }
            } catch {
              // if membership check fails, assume not present (non-fatal)
              setIsInPrivateList(false);
            }
          } else {
            setIsAdmin(false);
            setIsInPrivateList(false);
          }
        } catch {
          // ignore auth/admin check failures
          setCurrentUserId(null);
          setIsAdmin(false);
          setIsInPrivateList(false);
        }
      } catch (err: unknown) {
        const message = errToMessage(err);
        setMessage(message);
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
    // toggle: add to or remove from private list depending on current state
    setMessage(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) {
        setMessage("Sign in to modify your private list.");
        return;
      }

      if (isInPrivateList) {
        // remove from private list only (do not remove meanings or public occurrences)
        const res = await removeVocabFromPrivateList(userId, id, false);
        if (res?.error) {
          setMessage("Could not remove from private list (server rejection).");
          return;
        }
        setIsInPrivateList(false);
        setMessage("Removed from your private list.");
      } else {
        const res = await addVocabToPrivateList(userId, id);
        if (res?.error) {
          setMessage("Could not save (server rejection).");
          return;
        }
        setIsInPrivateList(true);
        setMessage("Saved to your private list.");
      }
    } catch (err: unknown) {
      setMessage(errToMessage(err));
    }
  }

  // create meaning (called from popover)
  async function createMeaning() {
    setMessage(null);
    const text = newMeaningText.trim();
    if (!text) {
      setMessage("Meaning text is required.");
      return;
    }
    try {
      const uid = await getCachedUserId();
      if (!uid) {
        setMessage("Sign in to create meanings.");
        return;
      }

      const sentencesArr = newMeaningSentences
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await supabase
        .from("meanings")
        .insert({
          vocab_id: id,
          itself: text,
          sentences: sentencesArr.length ? sentencesArr : null,
          owner_id: uid,
        })
        .select("id,itself,sentences,owner_id")
        .maybeSingle();

      if (res.error || !res.data) {
        setMessage(res.error?.message || "Failed to create meaning.");
        return;
      }

      // optimistic UI: append new meaning to local state
      setMeanings((prev) => [...prev, res.data as Meaning]);
      setNewMeaningText("");
      setNewMeaningSentences("");
      setMessage("Meaning created.");
    } catch (err: unknown) {
      setMessage(errToMessage(err));
    }
  }

  // delete meaning (try owner delete; on rejection offer drop ownership)
  async function deleteMeaning(meaningId: number) {
    setMessage(null);
    try {
      const uid = await getCachedUserId();
      if (!uid) {
        setMessage("Sign in to delete meanings.");
        return;
      }

      const delRes = await supabase
        .from("meanings")
        .delete()
        .match({ id: meaningId, owner_id: uid });

      if (delRes.error) {
        // deletion rejected — offer to drop ownership
        // Use native confirm for now; caller can be updated to alert-dialog later
        // per instruction: show option to drop ownership
        // Note: keep UX non-blocking on server FK rejections
        const drop = window.confirm(
          "Delete rejected by server. You can drop ownership instead (this will transfer ownership to no one). Proceed?"
        );
        if (!drop) {
          setMessage("Delete cancelled.");
          return;
        }
        const upd = await supabase
          .from("meanings")
          .update({ owner_id: null })
          .match({ id: meaningId });
        if (upd.error) {
          setMessage("Failed to drop ownership.");
          return;
        }
        // reflect change locally
        setMeanings((prev) =>
          prev.map((m) => (m.id === meaningId ? { ...m, owner_id: null } : m))
        );
        setMessage("Ownership dropped.");
        return;
      }

      // successful delete: remove from local state
      setMeanings((prev) => prev.filter((m) => m.id !== meaningId));
      setMessage("Meaning deleted.");
    } catch (err: unknown) {
      setMessage(errToMessage(err));
    }
  }

  // add sentence to meaning (only owner can)
  async function addSentence(meaningId: number, sentence: string) {
    setMessage(null);
    const s = sentence.trim();
    if (!s) {
      setMessage("Sentence is required.");
      return;
    }
    try {
      const uid = await getCachedUserId();
      if (!uid) {
        setMessage("Sign in to add sentences.");
        return;
      }
      const meaning = meanings.find((m) => m.id === meaningId);
      if (!meaning) {
        setMessage("Meaning not found.");
        return;
      }
      if (meaning.owner_id !== uid && !isAdmin) {
        setMessage("Only the owner can add sentences to this meaning.");
        return;
      }
      const newSentences = (meaning.sentences || []).concat(s);
      const res = await supabase
        .from("meanings")
        .update({ sentences: newSentences })
        .match({ id: meaningId })
        .select("id,itself,sentences,owner_id")
        .maybeSingle();
      if (res.error || !res.data) {
        setMessage("Failed to add sentence (server rejection).");
        return;
      }
      setMeanings((prev) =>
        prev.map((m) => (m.id === meaningId ? (res.data as Meaning) : m))
      );
      setNewSentenceText("");
      setAddingSentenceFor(null);
      setMessage("Sentence added.");
    } catch (err: unknown) {
      setMessage(errToMessage(err));
    }
  }

  // remove sentence by index (only owner can)
  async function removeSentence(meaningId: number, index: number) {
    setMessage(null);
    try {
      const uid = await getCachedUserId();
      if (!uid) {
        setMessage("Sign in to remove sentences.");
        return;
      }
      const meaning = meanings.find((m) => m.id === meaningId);
      if (!meaning) {
        setMessage("Meaning not found.");
        return;
      }
      if (meaning.owner_id !== uid && !isAdmin) {
        setMessage("Only the owner can remove sentences from this meaning.");
        return;
      }
      const sent = (meaning.sentences || []).slice();
      if (index < 0 || index >= sent.length) {
        setMessage("Invalid sentence index.");
        return;
      }
      sent.splice(index, 1);
      const res = await supabase
        .from("meanings")
        .update({ sentences: sent.length ? sent : null })
        .match({ id: meaningId })
        .select("id,itself,sentences,owner_id")
        .maybeSingle();
      if (res.error || !res.data) {
        setMessage("Failed to remove sentence (server rejection).");
        return;
      }
      setMeanings((prev) =>
        prev.map((m) => (m.id === meaningId ? (res.data as Meaning) : m))
      );
      setMessage("Sentence removed.");
    } catch (err: unknown) {
      setMessage(errToMessage(err));
    }
  }

  async function handleRemoveFromPrivate() {
    setMessage(null);
    try {
      const userId = await getCachedUserId();
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
    } catch (err: unknown) {
      setMessage(errToMessage(err));
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
          {isInPrivateList
            ? "Remove from private list"
            : "Save to private list"}
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
        <div className="flex items-center justify-between">
          <h2 className="font-semibold mb-2">Meanings</h2>
          {currentUserId && (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm">Add meaning</Button>
              </PopoverTrigger>
              <PopoverContent>
                <div className="space-y-2">
                  <Input
                    value={newMeaningText}
                    onChange={(e) =>
                      setNewMeaningText((e.target as HTMLInputElement).value)
                    }
                    placeholder="Meaning text"
                  />
                  <Textarea
                    value={newMeaningSentences}
                    onChange={(e) =>
                      setNewMeaningSentences(
                        (e.target as HTMLTextAreaElement).value
                      )
                    }
                    placeholder="Example sentences (one per line)"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={createMeaning}>
                      Create
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setNewMeaningText("");
                        setNewMeaningSentences("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        {meanings.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No meanings found.
          </div>
        ) : (
          <ul className="space-y-3">
            {meanings.map((m) => (
              <li key={m.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium">{m.itself}</div>
                    {m.sentences && m.sentences.length > 0 && (
                      <div className="mt-2 text-sm text-muted-foreground space-y-1">
                        {m.sentences.map((s, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between"
                          >
                            <div>• {s}</div>
                            {(m.owner_id === currentUserId || isAdmin) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => removeSentence(m.id, i)}
                              >
                                Remove
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {(m.owner_id === currentUserId || isAdmin) && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteMeaning(m.id)}
                      >
                        Delete
                      </Button>
                    )}

                    {m.owner_id === currentUserId && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button size="sm" variant="outline">
                            Add sentence
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent>
                          <div className="space-y-2">
                            <Input
                              value={
                                addingSentenceFor === m.id
                                  ? newSentenceText
                                  : ""
                              }
                              onChange={(e) => {
                                setAddingSentenceFor(m.id);
                                setNewSentenceText(
                                  (e.target as HTMLInputElement).value
                                );
                              }}
                              placeholder="New example sentence"
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={async () => {
                                  await addSentence(m.id, newSentenceText);
                                }}
                              >
                                Add
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setAddingSentenceFor(null);
                                  setNewSentenceText("");
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* RL items that use this vocabulary */}
      <div className="border-t pt-4 mt-6">
        <h2 className="font-semibold mb-2">
          Reading / Listening items using this vocabulary
        </h2>
        {rlItemsUsingVocab.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No reading/listening items found.
          </div>
        ) : (
          <ul className="space-y-2">
            {rlItemsUsingVocab.map((ri) => (
              <li
                key={ri.id}
                className="flex items-center justify-between p-2 rounded border"
              >
                <div>{ri.title ?? "Unnamed Content"}</div>
                <Button size="sm" asChild>
                  <Link to={`/rl-items?id=${ri.id}`}>Open</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
