import { useEffect, useState } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import supabase, {
  addVocabToPrivateList,
  addRlItemToPrivateList,
} from "../lib/supabase";
import { Link } from "react-router-dom";

/**
 * Discover page
 * - /discover/vocabs and /discover/lists are represented as Tabs
 * - Vocabs: shows recently added vocab (shuffled client-side) with quick "Save to my private list"
 * - Lists: shows recently created public lists with quick "Subscribe"
 * - Clicking an item expands it to show details and a button to go to the dedicated page
 *
 * Implementation focuses on UI-level behavior; server-side RLS errors are handled gracefully.
 */

type Vocab = {
  id: number;
  itself: string;
  created_at?: string | null;
};

type VocabList = {
  id: number;
  name: string;
  desc?: string | null;
  owner_id?: string | null;
  created_at?: string | null;
};

type RlItem = {
  id: number;
  title?: string | null;
  created_at?: string | null;
  owner_id?: string | null;
  delete_requested?: boolean | null;
  l_item_id?: string | null;
};

type RlList = {
  id: number;
  name?: string | null;
  desc?: string | null;
  owner_id?: string | null;
  created_at?: string | null;
};

// Helper to normalize unknown errors to a readable message
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function DiscoverPage() {
  const [active, setActive] = useState<
    "vocabs" | "vocablists" | "rlitems" | "rllists"
  >("vocabs");

  const [vocabs, setVocabs] = useState<Vocab[]>([]);
  const [lists, setLists] = useState<VocabList[]>([]);
  const [rlItems, setRlItems] = useState<RlItem[]>([]);
  const [rlLists, setRlLists] = useState<RlList[]>([]);
  const [loadingVocabs, setLoadingVocabs] = useState(false);
  const [loadingLists, setLoadingLists] = useState(false);
  const [loadingRlItems, setLoadingRlItems] = useState(false);
  const [loadingRlLists, setLoadingRlLists] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedVocab, setExpandedVocab] = useState<number | null>(null);
  const [expandedList, setExpandedList] = useState<number | null>(null);

  useEffect(() => {
    loadVocabs();
    loadLists();
    loadRlItems();
    loadRlLists();
  }, []);

  async function loadVocabs() {
    setLoadingVocabs(true);
    setMessage(null);
    try {
      const { data: vocabsRes, error } = await supabase
        .from("vocabs")
        .select("id,itself,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const arr = (vocabsRes || []) as Vocab[];
      // shuffle for random-like discovery
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      setVocabs(arr.slice(0, 20));
    } catch (err: unknown) {
      setMessage(errMsg(err));
      setVocabs([]);
    } finally {
      setLoadingVocabs(false);
    }
  }

  async function loadLists() {
    setLoadingLists(true);
    setMessage(null);
    try {
      const { data: listsRes, error } = await supabase
        .from("vocab_lists")
        .select("id,name,desc,owner_id,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setLists(listsRes || []);
    } catch (err: unknown) {
      setMessage(errMsg(err));
      setLists([]);
    } finally {
      setLoadingLists(false);
    }
  }

  // RL helpers for discovery
  async function loadRlItems() {
    setLoadingRlItems(true);
    setMessage(null);
    try {
      const { data: rlRes, error } = await supabase
        .from("rl_items")
        .select("id,title,created_at,owner_id,l_item_id,delete_requested")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const arr = (rlRes || []) as RlItem[];
      // shuffle for random-like discovery
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      setRlItems(arr.slice(0, 20));
    } catch (err: unknown) {
      console.warn("loadRlItems error", err);
      setRlItems([]);
    } finally {
      setLoadingRlItems(false);
    }
  }

  async function loadRlLists() {
    setLoadingRlLists(true);
    setMessage(null);
    try {
      const { data: listsRes, error } = await supabase
        .from("rl_lists")
        .select("id,name,desc,owner_id,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setRlLists(listsRes || []);
    } catch (err: unknown) {
      console.warn("loadRlLists error", err);
      setRlLists([]);
    } finally {
      setLoadingRlLists(false);
    }
  }

  async function handleSaveRlItem(rlItemId: number) {
    setMessage(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) {
        setMessage(
          "You must sign in to save reading/listening items to your private list."
        );
        return;
      }
      const res = await addRlItemToPrivateList(userId, rlItemId);
      if (res?.error) {
        console.warn("add rl_item to private list error", res.error);
        setMessage("Could not add to your private rl list (server rejection).");
        return;
      }
      setMessage("Saved to your private rl list.");
    } catch (err: unknown) {
      setMessage(errMsg(err));
    }
  }

  async function handleSaveVocab(vocabId: number) {
    setMessage(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) {
        setMessage("You must sign in to save vocab to your private list.");
        return;
      }
      const res = await addVocabToPrivateList(userId, vocabId);
      if (res?.error) {
        // graceful handling per instructions
        console.warn("add to private list error", res.error);
        setMessage("Could not add to private list (server rejection).");
        return;
      }
      setMessage("Saved to your private list.");
    } catch (err: unknown) {
      setMessage(errMsg(err));
    }
  }

  async function handleSubscribe(listId: number) {
    setMessage(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId) {
        setMessage("You must sign in to subscribe to lists.");
        return;
      }
      const res = await supabase
        .from("vocab_lists_sub")
        .insert({ user_id: userId, vocab_list_id: listId });
      if (res.error) {
        // RLS or FK rejection: show friendly message
        console.warn("subscribe error", res.error);
        setMessage("Could not subscribe (server rejection).");
        return;
      }
      setMessage("Subscribed to the list.");
      // Refresh lists subscription state if needed (not shown in this discovery view)
    } catch (err: unknown) {
      setMessage(errMsg(err));
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Discover</h1>

      {message && (
        <div className="mb-4 text-sm text-muted-foreground">{message}</div>
      )}

      <Tabs
        value={active}
        onValueChange={(v: string) =>
          setActive(
            v === "vocablists"
              ? "vocablists"
              : v === "rlitems"
                ? "rlitems"
                : v === "rllists"
                  ? "rllists"
                  : "vocabs"
          )
        }
      >
        <TabsList>
          <TabsTrigger value="vocabs">Vocabs</TabsTrigger>
          <TabsTrigger value="vocablists">Vocab Lists</TabsTrigger>
          <TabsTrigger value="rlitems">RL items</TabsTrigger>
          <TabsTrigger value="rllists">RL lists</TabsTrigger>
        </TabsList>

        <TabsContent value="vocabs">
          {loadingVocabs ? (
            <div className="text-sm">Loading vocabs...</div>
          ) : (
            <ul className="space-y-3 mt-4">
              {vocabs.map((v) => (
                <li key={v.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">{v.itself}</div>
                      <div className="text-xs text-muted-foreground">
                        Added: {v.created_at ?? "unknown"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSaveVocab(v.id)}
                      >
                        Save
                      </Button>
                      <Button size="sm" asChild>
                        <Link to={`/vocabs?id=${v.id}`}>Open</Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setExpandedVocab(expandedVocab === v.id ? null : v.id)
                        }
                      >
                        {expandedVocab === v.id ? "Hide" : "Details"}
                      </Button>
                    </div>
                  </div>

                  {expandedVocab === v.id && (
                    <div className="mt-3 text-sm">
                      <div>Loading meanings...</div>
                      <VocabMeanings vocabId={v.id} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="vocablists">
          {loadingLists ? (
            <div className="text-sm">Loading lists...</div>
          ) : (
            <ul className="space-y-3 mt-4">
              {lists.map((l) => (
                <li key={l.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.desc}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSubscribe(l.id)}
                      >
                        Subscribe
                      </Button>
                      <Button size="sm" asChild>
                        <Link to={`/lists?id=${l.id}`}>Open</Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setExpandedList(expandedList === l.id ? null : l.id)
                        }
                      >
                        {expandedList === l.id ? "Hide" : "Items"}
                      </Button>
                    </div>
                  </div>

                  {expandedList === l.id && (
                    <div className="mt-3 text-sm">
                      <ListItemsPreview listId={l.id} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="rlitems">
          {loadingRlItems ? (
            <div className="text-sm">Loading reading/listening items...</div>
          ) : (
            <ul className="space-y-3 mt-4">
              {rlItems.map((r) => (
                <li key={r.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">{r.title ?? "Unnamed"}</div>
                      <div className="text-xs text-muted-foreground">
                        Added: {r.created_at ?? "unknown"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSaveRlItem(r.id)}
                      >
                        Save
                      </Button>
                      <Button size="sm" asChild>
                        <Link to={`/rl-items?id=${r.id}`}>Open</Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setExpandedVocab(expandedVocab === r.id ? null : r.id)
                        }
                      >
                        {expandedVocab === r.id ? "Hide" : "Details"}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="rllists">
          {loadingRlLists ? (
            <div className="text-sm">Loading reading/listening lists...</div>
          ) : (
            <ul className="space-y-3 mt-4">
              {rlLists.map((l) => (
                <li key={l.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.desc}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          setMessage(null);
                          try {
                            const {
                              data: { user },
                            } = await supabase.auth.getUser();
                            const userId = user?.id;
                            if (!userId) {
                              setMessage(
                                "You must sign in to subscribe to lists."
                              );
                              return;
                            }
                            const res = await supabase
                              .from("rl_lists_sub")
                              .insert({ user_id: userId, rl_list_id: l.id });
                            if (res.error) {
                              console.warn("rl subscribe error", res.error);
                              setMessage(
                                "Could not subscribe (server rejection)."
                              );
                              return;
                            }
                            setMessage("Subscribed to the rl list.");
                          } catch (err: unknown) {
                            setMessage(errMsg(err));
                          }
                        }}
                      >
                        Subscribe
                      </Button>
                      <Button size="sm" asChild>
                        <Link to={`/rl-lists?id=${l.id}`}>Open</Link>
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * VocabMeanings - small component to fetch and display meanings for a vocab
 */
function VocabMeanings({ vocabId }: { vocabId: number }) {
  const [meanings, setMeanings] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("meanings")
          .select("itself")
          .eq("vocab_id", vocabId)
          .limit(20);
        if (error) throw error;
        if (!mounted) return;
        setMeanings((data || []).map((r: { itself: string }) => r.itself));
      } catch {
        setMeanings(["(failed to load)"]);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [vocabId]);

  if (loading) return <div className="text-sm">Loading meanings...</div>;
  if (!meanings || meanings.length === 0)
    return (
      <div className="text-sm text-muted-foreground">No meanings found.</div>
    );
  return (
    <div className="space-y-2">
      {meanings.map((m, idx) => (
        <div key={idx} className="text-sm">
          • {m}
        </div>
      ))}
    </div>
  );
}

/**
 * ListItemsPreview - small component to fetch some items of a list
 */
function ListItemsPreview({ listId }: { listId: number }) {
  const [items, setItems] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        // fetch vocab_ids from vocab_list_items then fetch vocabs
        const { data: idsRes, error: idsErr } = await supabase
          .from("vocab_list_items")
          .select("vocab_id")
          .eq("vocab_list_id", listId)
          .limit(10);
        if (idsErr) throw idsErr;
        const ids = (idsRes || []).map((r: { vocab_id: number }) => r.vocab_id);
        if (!ids.length) {
          setItems([]);
          return;
        }
        const { data: vocabsRes, error: vocErr } = await supabase
          .from("vocabs")
          .select("itself")
          .in("id", ids)
          .limit(10);
        if (vocErr) throw vocErr;
        if (!mounted) return;
        setItems((vocabsRes || []).map((r: { itself: string }) => r.itself));
      } catch {
        setItems(["(failed to load)"]);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [listId]);

  if (loading) return <div className="text-sm">Loading items...</div>;
  if (!items || items.length === 0)
    return (
      <div className="text-sm text-muted-foreground">
        No items in this list.
      </div>
    );
  return (
    <div className="space-y-2">
      {items.map((it, idx) => (
        <div key={idx} className="text-sm">
          • {it}
        </div>
      ))}
    </div>
  );
}
