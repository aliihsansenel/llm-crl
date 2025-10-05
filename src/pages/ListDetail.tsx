import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import supabase from "../lib/supabase";
import { Button } from "../components/ui/button";

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

        const { data: listRes, error: listErr } = await supabase
          .from("vocab_lists")
          .select("id,name,desc,owner_id,created_at")
          .eq("id", id)
          .maybeSingle();
        if (listErr) throw listErr;
        if (!mounted) return;
        setList(listRes ?? null);

        // fetch up to 20 items
        const { data: idsRes, error: idsErr } = await supabase
          .from("vocab_list_items")
          .select("vocab_id")
          .eq("vocab_list_id", id)
          .limit(20);
        if (idsErr) throw idsErr;
        const ids = (idsRes || []).map((r: any) => r.vocab_id);
        if (ids.length > 0) {
          const { data: vocabsRes, error: vocErr } = await supabase
            .from("vocabs")
            .select("id,itself")
            .in("id", ids)
            .limit(20);
          if (vocErr) throw vocErr;
          if (!mounted) return;
          setItems((vocabsRes || []) as Vocab[]);
        } else {
          setItems([]);
        }

        // check subscription status if user signed in
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const userId = user?.id;
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
      <h1 className="text-2xl font-semibold mb-2">{list.name}</h1>
      <div className="text-xs text-muted-foreground mb-2">
        Created: {list.created_at ?? "unknown"}
      </div>
      <div className="mb-4 text-sm text-muted-foreground">{list.desc}</div>

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
          <div className="text-sm text-muted-foreground">
            No items in this list.
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((v) => (
              <li key={v.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{v.itself}</div>
                  <div className="flex gap-2">
                    <Button size="sm" asChild>
                      <Link to={`/vocabs?id=${v.id}`}>Open</Link>
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
