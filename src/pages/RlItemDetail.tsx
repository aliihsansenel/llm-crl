import { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import supabase, {
  getCachedUserId,
  ensureUserResources,
  getCachedSessionAccessToken,
} from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "../components/ui/dropdown-menu";

type Row = {
  vocabId?: number;
  vocabText?: string;
  meaningId?: number;
  meaningText?: string;
};

type RlItemRow = {
  id: number;
  title?: string | null;
  r_item?: string | null;
  l_item_id?: string | null;
  owner_id?: string | null;
  delete_requested?: boolean | null;
  instructions?: string | null;
  level_id?: number | null;
};

export default function RlItemDetail() {
  const [params] = useSearchParams();
  const idParam = params.get("id");
  const id = idParam ? Number(idParam) : NaN;
  const navigate = useNavigate();
  const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
  // Presigned URL expiry seconds - configured via VITE_PRESIGNED_URL_EXPIRES (fallback 3600s)
  const PRESIGNED_URL_EXPIRES = Number(
    import.meta.env.VITE_PRESIGNED_URL_EXPIRES ?? 3600
  );

  const [rlItem, setRlItem] = useState<RlItemRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  // left-side rows (3..10)
  const [rows, setRows] = useState<Row[]>([{}, {}, {}]);
  const [activeIndex, setActiveIndex] = useState(0);

  // right-side lists
  const [privateVocabs, setPrivateVocabs] = useState<
    { id: number; itself: string }[]
  >([]);
  const [meaningsForSelectedVocab, setMeaningsForSelectedVocab] = useState<
    { id: number; itself: string }[]
  >([]);

  // "Filter to unused vocabulary" feature state + memoization cache
  const [filterUnused, setFilterUnused] = useState(false);
  // cached unused results keyed by user id to avoid refetching
  const unusedCacheRef = useRef<
    Record<
      string,
      {
        vocabs: {
          id: number;
          itself: string;
          meanings: { id: number; itself: string }[];
        }[];
      }
    >
  >({});
  const [unusedVocabs, setUnusedVocabs] = useState<
    { id: number; itself: string; meanings: { id: number; itself: string }[] }[]
  >([]);
  const [loadingUnused, setLoadingUnused] = useState(false);

  const [instructions, setInstructions] = useState("");
  const [creating, setCreating] = useState(false);

  // listening/audio states
  const [lItemPublicUrl, setLItemPublicUrl] = useState<string | null>(null);
  const [creatingListening, setCreatingListening] = useState(false);
  // audio element ref and a simple guard to avoid concurrent resign attempts
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resigningRef = useRef(false);

  // levels and page-level selection (default from user settings)
  const [levels, setLevels] = useState<{ id: number; itself: string }[]>([]);
  const [pageLevelId, setPageLevelId] = useState<number | null>(null);
  const [userSettingsLevelId, setUserSettingsLevelId] = useState<number | null>(
    null
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        if (!id || Number.isNaN(id)) {
          setMessage("Invalid rl_item id");
          setLoading(false);
          return;
        }

        // load rl_item row (include instructions & level_id)
        const { data: rRes, error: rErr } = await supabase
          .from("rl_items")
          .select(
            "id,title,r_item,l_item_id,owner_id,delete_requested,instructions,level_id"
          )
          .eq("id", id)
          .maybeSingle();
        if (rErr) throw rErr;
        if (!mounted) return;
        setRlItem(rRes ?? null);

        // populate instructions from rl_item (if present)
        if (rRes?.instructions) {
          setInstructions(rRes.instructions);
        }

        // initialize pageLevelId from rl_item.level_id if present
        if (rRes?.level_id != null) {
          setPageLevelId(rRes.level_id);
        }

        // load any pre-existing vocab-meaning pairs for this rl_item
        try {
          const { data: pairsRes, error: pairsErr } = await supabase
            .from("rl_item_vocabs_and_meanings")
            .select("vocab_id,meaning_id,vocabs(id,itself),meanings(id,itself)")
            .eq("rl_item_id", id)
            .order("id", { ascending: true })
            .limit(10);
          if (pairsErr) throw pairsErr;

          // pairsRes may include nested relation fields as arrays (vocabs: [{...}]) depending on response.
          // Normalize defensively without using `any` so types remain safe.
          if (pairsRes && Array.isArray(pairsRes) && pairsRes.length > 0) {
            const mapped: Row[] = pairsRes.map((p) => {
              const obj = p as Record<string, unknown>;

              // extract nested vocabs field (may be array or object)
              let vocabObj: Record<string, unknown> | undefined;
              if (Array.isArray(obj.vocabs)) {
                vocabObj = (obj.vocabs as unknown[])[0] as
                  | Record<string, unknown>
                  | undefined;
              } else if (obj.vocabs && typeof obj.vocabs === "object") {
                vocabObj = obj.vocabs as Record<string, unknown>;
              }

              // extract nested meanings field (may be array or object)
              let meaningObj: Record<string, unknown> | undefined;
              if (Array.isArray(obj.meanings)) {
                meaningObj = (obj.meanings as unknown[])[0] as
                  | Record<string, unknown>
                  | undefined;
              } else if (obj.meanings && typeof obj.meanings === "object") {
                meaningObj = obj.meanings as Record<string, unknown>;
              }

              const vocabId =
                typeof obj.vocab_id === "number"
                  ? (obj.vocab_id as number)
                  : Number(obj.vocab_id);
              const meaningId =
                typeof obj.meaning_id === "number"
                  ? (obj.meaning_id as number)
                  : Number(obj.meaning_id);

              return {
                vocabId,
                vocabText:
                  typeof vocabObj?.itself === "string"
                    ? (vocabObj.itself as string)
                    : undefined,
                meaningId,
                meaningText:
                  typeof meaningObj?.itself === "string"
                    ? (meaningObj.itself as string)
                    : undefined,
              } as Row;
            });

            // ensure minimum 3 rows and maximum 10
            while (mapped.length < 3) mapped.push({});
            setRows(mapped.slice(0, 10));
          } else {
            // ensure default 3 empty rows if no pairs provided
            setRows([{}, {}, {}]);
          }
        } catch (e) {
          // non-fatal - log and continue
          // eslint-disable-next-line no-console
          console.warn("failed to load rl_item vocab-meaning pairs", e);
        }

        // load private vocabs (last 30)
        const userId = await getCachedUserId();
        if (userId) {
          await ensureUserResources(userId);
          const { data: pList } = await supabase
            .from("p_vocab_lists")
            .select("id")
            .eq("owner_id", userId)
            .limit(1)
            .maybeSingle();
          const listId = pList?.id;
          if (listId) {
            const { data: itemsRes } = await supabase
              .from("p_vocab_list_items")
              .select("vocab_id")
              .eq("p_vocab_list_id", listId)
              .order("vocab_id", { ascending: false })
              .limit(30);
            const ids = (itemsRes || []).map(
              (r: { vocab_id: number }) => r.vocab_id
            );
            if (ids.length) {
              const { data: vocabs } = await supabase
                .from("vocabs")
                .select("id,itself")
                .in("id", ids)
                .order("created_at", { ascending: false })
                .limit(30);
              if (vocabs) setPrivateVocabs(vocabs);
            }
          }

          // load user settings.level_id and available levels
          try {
            const { data: sRes, error: sErr } = await supabase
              .from("settings")
              .select("level_id")
              .eq("user_id", userId)
              .maybeSingle();
            if (!sErr && sRes) {
              const lvl = sRes.level_id ?? null;
              setUserSettingsLevelId(lvl);
              // initialize pageLevelId from user's setting if not set yet
              setPageLevelId((prev) => (prev == null ? lvl : prev));
            }
          } catch (e) {
            // non-fatal
            // eslint-disable-next-line no-console
            console.warn("failed to load user settings", e);
          }

          try {
            const { data: lvls } = await supabase
              .from("levels")
              .select("id,itself")
              .order("id", { ascending: true });
            if (lvls) setLevels(lvls);
          } catch (e) {
            // non-fatal
            // eslint-disable-next-line no-console
            console.warn("failed to load levels", e);
          }
        }
      } catch (err: unknown) {
        setMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  // select a vocab to populate the active row and load meanings
  async function selectVocabForActiveRow(vocabId: number, vocabText: string) {
    setMessage(null);
    try {
      setRows((prev) => {
        const copy = prev.slice();
        copy[activeIndex] = {
          ...copy[activeIndex],
          vocabId,
          vocabText,
          meaningId: undefined,
          meaningText: undefined,
        };
        return copy;
      });

      // If filterUnused is active and we have an unused mapping cached in memory,
      // prefer that local result to avoid extra network requests.
      if (filterUnused) {
        const userId = await getCachedUserId();
        const cacheForUser = userId
          ? (unusedCacheRef.current[userId] ?? null)
          : null;
        if (cacheForUser) {
          const entry = cacheForUser.vocabs.find((v) => v.id === vocabId);
          setMeaningsForSelectedVocab(entry?.meanings ?? []);
          return;
        }

        // If we don't have a cached mapping yet but the component-level unusedVocabs exists,
        // use that as a fallback.
        const found = unusedVocabs.find((v) => v.id === vocabId);
        if (found) {
          setMeaningsForSelectedVocab(found.meanings);
          return;
        }
        // otherwise fallthrough to fetch (server-side) - this is rare because fetchUnusedVocabs is invoked when filter toggled.
      }

      const { data: mRes, error: mErr } = await supabase
        .from("meanings")
        .select("id,itself")
        .eq("vocab_id", vocabId)
        .order("id", { ascending: true })
        .limit(100);
      if (mErr) throw mErr;
      setMeaningsForSelectedVocab(
        (mRes || []) as { id: number; itself: string }[]
      );
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  // Fetch unused vocab/meaning pairs for current user and memoize the result.
  async function fetchUnusedVocabs() {
    setLoadingUnused(true);
    try {
      const userId = await getCachedUserId();
      if (!userId) {
        setUnusedVocabs([]);
        return;
      }

      // If we have a cached entry for this user, use it
      if (unusedCacheRef.current[userId]) {
        setUnusedVocabs(unusedCacheRef.current[userId].vocabs);
        return;
      }

      // Ensure we have private vocab IDs. Prefer existing privateVocabs state,
      // otherwise fetch the private list and its items (same as initial load).
      let vocabIds: number[] = privateVocabs.map((v) => v.id);
      if (vocabIds.length === 0) {
        // Try to fetch private list id and its items
        const { data: pList } = await supabase
          .from("p_vocab_lists")
          .select("id")
          .eq("owner_id", userId)
          .limit(1)
          .maybeSingle();
        const listId = pList?.id;
        if (listId) {
          const { data: itemsRes } = await supabase
            .from("p_vocab_list_items")
            .select("vocab_id")
            .eq("p_vocab_list_id", listId)
            .order("vocab_id", { ascending: false })
            .limit(1000);
          vocabIds = (itemsRes || []).map(
            (r: { vocab_id: number }) => r.vocab_id
          );
        }
      }

      if (!vocabIds.length) {
        setUnusedVocabs([]);
        // cache empty result
        unusedCacheRef.current[userId] = { vocabs: [] };
        return;
      }

      // Fetch meanings owned by the user for these vocabs
      const { data: meanings } = await supabase
        .from("meanings")
        .select("id,itself,vocab_id")
        .in("vocab_id", vocabIds)
        .eq("owner_id", userId)
        .limit(1000);

      const meaningList = meanings || [];
      const meaningIds = meaningList.map((m) => m.id);

      // Fetch usages for these meanings in rl_item_vocabs_and_meanings
      let usages: { meaning_id: number }[] = [];
      if (meaningIds.length) {
        const { data: u } = await supabase
          .from("rl_item_vocabs_and_meanings")
          .select("meaning_id")
          .in("meaning_id", meaningIds)
          .limit(10000);
        usages = u || [];
      }

      const usedSet = new Set((usages || []).map((u) => u.meaning_id));
      const unusedMeanings = (meaningList || []).filter(
        (m) => !usedSet.has(m.id)
      );

      // group unused meanings by vocab_id and prepare vocabs list with their unused meanings
      const byVocab = new Map<
        number,
        {
          id: number;
          itself: string;
          meanings: { id: number; itself: string }[];
        }
      >();
      // fetch vocab texts for vocabIds (only those that have unused meanings)
      const vocabIdsWithUnused = Array.from(
        new Set(unusedMeanings.map((m) => m.vocab_id))
      );
      const vocabsMap = new Map<number, { id: number; itself: string }>();
      if (vocabIdsWithUnused.length) {
        const { data: vocabs } = await supabase
          .from("vocabs")
          .select("id,itself")
          .in("id", vocabIdsWithUnused)
          .limit(1000);
        (vocabs || []).forEach((v) => vocabsMap.set(v.id, v));
      }

      for (const m of unusedMeanings) {
        const vId = m.vocab_id;
        const v = vocabsMap.get(vId) || { id: vId, itself: "Unknown" };
        const entry = byVocab.get(vId) || {
          id: v.id,
          itself: v.itself,
          meanings: [] as { id: number; itself: string }[],
        };
        entry.meanings.push({ id: m.id, itself: m.itself });
        byVocab.set(vId, entry);
      }

      const result = Array.from(byVocab.values());
      // cache result
      unusedCacheRef.current[userId] = { vocabs: result };
      setUnusedVocabs(result);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("failed to fetch unused vocabs", e);
      setUnusedVocabs([]);
    } finally {
      setLoadingUnused(false);
    }
  }

  function selectMeaningForRow(meaningId: number, meaningText: string) {
    setRows((prev) => {
      const copy = prev.slice();
      copy[activeIndex] = {
        ...copy[activeIndex],
        meaningId,
        meaningText,
      };
      return copy;
    });
  }

  function addFourthRow() {
    if (rows.length >= 10) return;
    setRows((prev) => [...prev, {}]);
  }

  function removeRow(index: number) {
    if (rows.length <= 3) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
    setActiveIndex(Math.max(0, Math.min(activeIndex, rows.length - 2)));
  }

  function allRowsValid() {
    if (rows.length < 3) return false;
    return rows.every(
      (r) => typeof r.vocabId === "number" && typeof r.meaningId === "number"
    );
  }

  function selectedMeaningIds() {
    return rows.map((r) => r.meaningId as number);
  }

  async function handleCreateReading() {
    if (!rlItem) return;
    setMessage(null);
    if (!allRowsValid()) {
      setMessage("Please select vocab and meaning for all rows.");
      return;
    }

    // require a selected level (nullable allowed elsewhere, but page requires a level)
    if (pageLevelId == null) {
      setMessage("Please select a level before creating reading material.");
      return;
    }

    setCreating(true);

    const meaningIds = selectedMeaningIds();

    try {
      // obtain current user's jwt so the edge function receives the authenticated token
      const token = await getCachedSessionAccessToken();
      if (!token) {
        throw new Error("Not authenticated (no access token)");
      }

      // create an abort controller to enforce the configured timeout (152s per current requirements)
      const controller = new AbortController();
      const TIMEOUT_MS = 152_000;
      const timeoutId = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

      // Use supabase.functions.invoke and include Authorization header + signal
      const { data, error } = await supabase.functions.invoke(
        "create-reading-text",
        {
          method: "POST",
          body: {
            id: rlItem.id,
            meanings: meaningIds,
            instructions: instructions || null,
            level_id: pageLevelId,
          },
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (error) {
        throw error;
      }

      // data is the response from the edge function (parsed automatically)
      // expected: { ok: true, rl_item: { id, title, text, level_id }, tokens: {...} }
      if (!data || !data.ok || !data.rl_item) {
        throw new Error("edge function returned unexpected response");
      }

      const returned = data.rl_item;

      setRlItem((prev) =>
        prev
          ? {
              ...prev,
              title: returned.title ?? prev.title,
              r_item: returned.text ?? prev.r_item,
              level_id: returned.level_id ?? prev.level_id,
              // if edge provided l_item_id include it
              l_item_id: (returned.l_item_id ?? prev.l_item_id) as
                | string
                | null,
            }
          : prev
      );

      // if edge returned a level, update page level too
      if (returned.level_id != null) {
        setPageLevelId(returned.level_id);
      }

      // update instructions if edge returned them
      if (returned.instructions) {
        setInstructions(returned.instructions);
      }

      setMessage("Reading material created.");
    } catch (err: unknown) {
      // handle AbortError specifically (timeout)
      if (err instanceof DOMException && err.name === "AbortError") {
        setMessage(
          `Edge function request timed out after ${152_000 / 1000} seconds. Attempting to refresh rl_item...`
        );

        // After timeout: re-fetch the rl_item row and populate page fields so UI reflects latest server state
        try {
          const { data: refreshed, error: refErr } = await supabase
            .from("rl_items")
            .select(
              "id,title,r_item,l_item_id,owner_id,delete_requested,instructions,level_id"
            )
            .eq("id", rlItem.id)
            .maybeSingle();

          if (!refErr && refreshed) {
            setRlItem(refreshed);
            if (refreshed.instructions) setInstructions(refreshed.instructions);
            if (refreshed.level_id != null) setPageLevelId(refreshed.level_id);
          } else if (refErr) {
            // eslint-disable-next-line no-console
            console.warn("failed to refetch rl_item after timeout", refErr);
          }
        } catch (refetchErr) {
          // eslint-disable-next-line no-console
          console.warn("refetch after timeout failed", refetchErr);
        }
      } else if (err instanceof Error) {
        setMessage(err.message);
      } else {
        setMessage(String(err));
      }
    } finally {
      setCreating(false);
    }
  }

  // Create listening (audio) helpers -------------------------------------------------
  async function handleCreateListening() {
    if (!rlItem) return;
    setMessage(null);
    setCreatingListening(true);
    try {
      // get current session and access token (jwt)
      const token = await getCachedSessionAccessToken();
      if (!token) {
        throw new Error("Not authenticated (no access token)");
      }

      // call public lambda endpoint
      const resp = await fetch(
        "https://5lklgc5015.execute-api.eu-central-1.amazonaws.com/default/create-listening-audio",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jwt_token: token, rl_item_id: rlItem.id }),
        }
      );

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const errMsg =
          json?.error || JSON.stringify(json) || `Status ${resp.status}`;
        throw new Error(errMsg);
      }

      // mark as in-progress locally (ZERO_UUID sentinel)
      setRlItem((prev) => (prev ? { ...prev, l_item_id: ZERO_UUID } : prev));
      setMessage("Audio creation started. Polling for completion...");
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingListening(false);
    }
  }

  // Polling effect: when rlItem.l_item_id === ZERO_UUID, poll rl_items dynamically.
  // After every 10 polling iterations double the interval until reaching 2 minutes (120_000ms).
  // When 2 minutes is reached stop polling.
  useEffect(() => {
    let timer: number | undefined;
    let mounted = true;
    let pollCount = 0;
    let currentInterval = 5000; // start at 5s
    const MAX_INTERVAL = 120_000; // 2 minutes cap

    async function fetchPublicUrlForUid(uid: string | null) {
      if (!uid) return;
      try {
        // First check localStorage for a cached signed URL entry
        const key = `litem:${uid}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as {
              public_url?: string;
              expires_at?: number;
            };
            if (
              parsed?.public_url &&
              parsed.expires_at &&
              parsed.expires_at > Date.now()
            ) {
              setLItemPublicUrl(parsed.public_url);
              return;
            }
          } catch {
            // ignore JSON parse errors and continue to fetch a fresh url
          }
        }

        const { data } = await supabase
          .from("l_items")
          .select("public_url")
          .eq("uid", uid)
          .maybeSingle();
        if (!mounted) return;
        if (data?.public_url) {
          setLItemPublicUrl(data.public_url);
          // cache it with expiry
          try {
            const cache = {
              public_url: data.public_url,
              expires_at: Date.now() + PRESIGNED_URL_EXPIRES * 1000,
            };
            localStorage.setItem(key, JSON.stringify(cache));
          } catch {
            // ignore localStorage set errors
          }
        }
      } catch (e) {
        // non-fatal
        // eslint-disable-next-line no-console
        console.warn("failed to fetch l_items public_url", e);
      }
    }

    async function pollOnce() {
      if (!mounted || !rlItem) return;
      try {
        const { data, error } = await supabase
          .from("rl_items")
          .select("l_item_id")
          .eq("id", rlItem.id)
          .maybeSingle();
        if (error) {
          // eslint-disable-next-line no-console
          console.warn("poll error", error);
          scheduleNext();
          return;
        }
        const latest = data?.l_item_id;
        if (latest && latest !== ZERO_UUID) {
          // update rlItem and stop polling
          setRlItem((prev) => (prev ? { ...prev, l_item_id: latest } : prev));
          // fetch the public url for the created listening item
          await fetchPublicUrlForUid(latest);
          return; // stop further polling
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("poll iteration error", e);
      }

      pollCount++;
      // After every 5 polls double the interval, cap at MAX_INTERVAL
      if (pollCount % 5 === 0) {
        currentInterval = Math.min(currentInterval * 2, MAX_INTERVAL);
        // If we've reached max interval, stop polling per requirement
        if (currentInterval >= MAX_INTERVAL) {
          return;
        }
      }
      scheduleNext();
    }

    function scheduleNext() {
      if (!mounted) return;
      timer = window.setTimeout(pollOnce, currentInterval);
    }

    if (!rlItem) {
      return () => {
        mounted = false;
        if (timer) window.clearTimeout(timer);
      };
    }

    if (rlItem.l_item_id === ZERO_UUID) {
      // initialize polling state and start
      pollCount = 0;
      currentInterval = 5000;
      scheduleNext();
    } else if (rlItem.l_item_id != null) {
      // l_item_id is a real uid (not ZERO_UUID); fetch public url once
      fetchPublicUrlForUid(rlItem.l_item_id);
    } else {
      // no l_item_id -> clear public url
      setLItemPublicUrl(null);
    }

    return () => {
      mounted = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [rlItem?.l_item_id, rlItem?.id]);

  // Attempt to get a fresh presigned URL by calling the resign lambda.
  // NOTE: Replace RESIGN_LAMBDA_URL with the actual deployed lambda URL.
  async function getFreshSignedUrl() {
    if (!rlItem?.l_item_id) {
      throw new Error("no l_item_id available to resign");
    }

    // obtain current user's jwt
    const token = await getCachedSessionAccessToken();
    if (!token) {
      throw new Error("Not authenticated (no access token)");
    }

    const RESIGN_LAMBDA_URL =
      "https://961mjnnmx1.execute-api.eu-central-1.amazonaws.com/default/resign-listening-url"; // <- replace this
    // "https://ol2jttxrbczf5bbyzc3phcoqqu0yiomx.lambda-url.eu-central-1.on.aws"; // <- replace this

    const resp = await fetch(RESIGN_LAMBDA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jwt_token: token, l_item_uid: rlItem.l_item_id }),
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const errMsg = json?.error || `Status ${resp.status}`;
      throw new Error(`Resign lambda error: ${errMsg}`);
    }
    if (!json?.ok || !json?.public_url) {
      throw new Error("Resign lambda returned no public_url");
    }

    // Cache the signed URL in localStorage with an expiry so we don't resign on every page load.
    try {
      const key = `litem:${rlItem.l_item_id}`;
      const cache = {
        public_url: json.public_url,
        expires_at: Date.now() + PRESIGNED_URL_EXPIRES * 1000,
      };
      localStorage.setItem(key, JSON.stringify(cache));
    } catch {
      // ignore localStorage errors
    }

    return json.public_url;
  }

  // When the audio element reports an error (most likely because the signed URL expired),
  // attempt to obtain a fresh signed URL and resume playback. We avoid running any
  // network checks on every play to prevent repeated HEAD/range fetches on pause/play.
  async function handleAudioError() {
    if (!lItemPublicUrl || !audioRef.current) return;
    if (resigningRef.current) return;
    try {
      resigningRef.current = true;
      setMessage("Refreshing audio URL...");
      const fresh = await getFreshSignedUrl();
      setLItemPublicUrl(fresh);

      if (audioRef.current) {
        // update src and attempt to play; playback may still be blocked by browser
        audioRef.current.src = fresh;
        try {
          await audioRef.current.play();
        } catch (playErr) {
          // eslint-disable-next-line no-console
          console.warn("play after resign failed", playErr);
        }
      }
      setMessage(null);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      resigningRef.current = false;
    }
  }

  // Try to download the audio without triggering a full download when possible.
  // On 403 (expired/forbidden) we call the resign lambda to obtain a fresh URL.
  async function handleDownload() {
    if (!lItemPublicUrl) {
      setMessage("No audio url available to download.");
      return;
    }
    setMessage(null);

    try {
      // Try a lightweight HEAD request first to detect 403 without downloading file.
      let accessible = false;
      try {
        const headResp = await fetch(lItemPublicUrl, { method: "HEAD" });
        if (headResp.ok) accessible = true;
        else if (headResp.status === 403) accessible = false;
        else accessible = headResp.ok;
      } catch (headErr) {
        // Some endpoints disallow HEAD — attempt a tiny range GET
        // log the head error for observability
        // eslint-disable-next-line no-console
        console.warn(
          "HEAD request failed or blocked, falling back to range GET",
          headErr
        );
        try {
          const rangeResp = await fetch(lItemPublicUrl, {
            method: "GET",
            headers: { Range: "bytes=0-9" },
          });
          if (rangeResp.ok) accessible = true;
          else if (rangeResp.status === 403) accessible = false;
          else accessible = rangeResp.ok;
        } catch (rangeErr) {
          // eslint-disable-next-line no-console
          console.warn(
            "Range GET failed while checking audio URL accessibility",
            rangeErr
          );
          accessible = false;
        }
      }

      let finalUrl = lItemPublicUrl;
      if (!accessible) {
        // Obtain a fresh signed URL from the resign lambda
        const fresh = await getFreshSignedUrl();
        finalUrl = fresh;
        // update local state so audio player uses fresh URL going forward
        setLItemPublicUrl(fresh);
      }

      // Trigger browser download (opens new tab/download)
      const a = document.createElement("a");
      a.href = finalUrl;
      a.target = "_blank";
      a.rel = "noreferrer";
      // leave download attr empty so browser chooses filename from headers
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  // Remove the rl_item from the current user's private list
  async function removeFromPrivateList() {
    if (!rlItem) return { ok: false, error: new Error("no rl item") };
    try {
      const userId = await getCachedUserId();
      if (!userId) return { ok: false, error: new Error("not signed in") };

      const { data: pList } = await supabase
        .from("p_rl_lists")
        .select("id")
        .eq("owner_id", userId)
        .limit(1)
        .maybeSingle();
      const listId = pList?.id;
      if (!listId) {
        return { ok: false, error: new Error("private list not found") };
      }

      const delRes = await supabase
        .from("p_rl_list_items")
        .delete()
        .match({ p_rl_list_id: listId, rl_item_id: rlItem.id });

      if (delRes.error) {
        // do not block flow for UI; return error info
        return { ok: false, error: delRes.error };
      }

      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err };
    }
  }

  // Click handler for Delete button: always remove from private list first.
  // If the current user is the owner, open confirm dialog to delete the rl_item itself.
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  async function handleDeleteClick() {
    if (!rlItem) return;
    setMessage(null);
    try {
      const userId = await getCachedUserId();
      if (!userId) {
        setMessage("You must be signed in to remove items.");
        return;
      }

      const removed = await removeFromPrivateList();
      if (!removed.ok) {
        console.warn("failed to remove from private list", removed.error);
        // proceed: per requirements removal attempt should be made; continue flow
      } else {
        setMessage("Removed from your private list.");
      }

      // if current user is owner, ask whether they want to delete the rl_item itself
      if (rlItem.owner_id === userId) {
        setShowConfirmDelete(true);
        return;
      }

      // if not owner, navigate back to listing
      navigate("/rl-items");
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  // Confirmed deletion of the rl_item itself (owner only)
  async function handleConfirmDelete() {
    if (!rlItem) return;
    setMessage(null);
    setShowConfirmDelete(false);
    try {
      if (!rlItem.l_item_id) {
        const del = await supabase
          .from("rl_items")
          .delete()
          .match({ id: rlItem.id });
        if (del.error) {
          // if deletion rejected, set delete_requested = true
          const upd = await supabase
            .from("rl_items")
            .update({ delete_requested: true })
            .match({ id: rlItem.id });
          if (upd.error) {
            throw upd.error;
          }
          setRlItem((prev) =>
            prev ? { ...prev, delete_requested: true } : prev
          );
          setMessage("Delete requested.");
        } else {
          setMessage("Deleted.");
          navigate("/rl-items");
        }
      } else {
        const upd = await supabase
          .from("rl_items")
          .update({ delete_requested: true })
          .match({ id: rlItem.id });
        if (upd.error) throw upd.error;
        setRlItem((prev) =>
          prev ? { ...prev, delete_requested: true } : prev
        );
        setMessage("Delete requested.");
      }
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  // check if meaning already used in any row
  function isMeaningChosenElsewhere(meaningId: number) {
    return rows.some((r) => r.meaningId === meaningId);
  }

  if (loading) return <div className="p-6 text-sm">Loading...</div>;
  if (!rlItem)
    return (
      <div className="p-6 text-sm text-red-600">
        {message ?? "Item not found."}
      </div>
    );

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-semibold mb-2">
        {rlItem.title ?? "Unnamed Content"}
      </h1>
      <div className="text-sm text-muted-foreground mb-4">
        {rlItem.l_item_id
          ? rlItem.l_item_id === ZERO_UUID
            ? "Listening audio creation in progress..."
            : `Listening id: ${rlItem.l_item_id}`
          : "No listening material yet"}
        <div className="mt-3 flex items-center gap-3">
          <Button
            size="sm"
            onClick={handleCreateListening}
            disabled={creatingListening || rlItem.l_item_id != null}
          >
            {creatingListening ? "Starting..." : "Create listening material"}
          </Button>

          {lItemPublicUrl && (
            <div className="flex-1 flex items-center gap-3">
              <audio
                ref={audioRef}
                controls
                preload="none"
                src={lItemPublicUrl}
                className="w-full"
                onError={handleAudioError}
              />
              <div>
                <Button size="sm" onClick={handleDownload}>
                  Download
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {message && (
        <div className="mb-4 text-sm text-muted-foreground">{message}</div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="border p-4 rounded">
          <div className="mb-2 font-semibold">Vocab-Meaning Pairs</div>
          <div className="space-y-2">
            {rows.map((r, idx) => (
              <div
                key={idx}
                className={`p-3 rounded border ${idx === activeIndex ? "bg-accent/10" : ""}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">Row {idx + 1}</div>
                  <div className="flex gap-2">
                    {rows.length > 3 && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => removeRow(idx)}
                      >
                        Remove
                      </Button>
                    )}
                    {idx === rows.length - 1 && rows.length < 10 && (
                      <Button size="sm" onClick={addFourthRow}>
                        Add
                      </Button>
                    )}
                  </div>
                </div>

                <div className="text-xs mb-2">Vocab: {r.vocabText ?? "—"}</div>
                <div className="text-xs mb-2">
                  Meaning: {r.meaningText ?? "—"}
                </div>

                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setActiveIndex(idx)}>
                    Edit Row
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRows((prev) => {
                        const copy = prev.slice();
                        copy[idx] = {};
                        return copy;
                      });
                      // if clearing the active row, also clear meanings list if this was active
                      if (idx === activeIndex) setMeaningsForSelectedVocab([]);
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border p-4 rounded">
          <div className="mb-2 font-semibold">Select Vocab / Meanings</div>

          <div className="mb-3">
            <div className="flex items-center justify-between">
              <div className="text-sm mb-1">Private Vocabs (last 30)</div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={filterUnused}
                  onCheckedChange={(v) => {
                    const val = Boolean(v);
                    setFilterUnused(val);
                    if (val) {
                      // when enabling, fetch and memoize unused list if needed
                      fetchUnusedVocabs();
                    }
                  }}
                />
                <span>Filter to unused vocabulary</span>
              </label>
            </div>

            {/* If filter is active show unused vocabs + their unused meanings */}
            {filterUnused ? (
              <div className="space-y-2 max-h-64 overflow-auto">
                {loadingUnused && <div className="text-xs">Loading...</div>}
                {!loadingUnused && !unusedVocabs.length && (
                  <div className="text-xs text-muted-foreground">
                    No unused vocabulary/meanings found.
                  </div>
                )}
                {!loadingUnused &&
                  unusedVocabs.map((v) => (
                    <div
                      key={v.id}
                      className="p-2 rounded border hover:bg-muted"
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{v.itself}</div>
                      </div>
                      <div className="mt-2 space-y-1">
                        {v.meanings.map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between p-1 rounded"
                          >
                            <div className="text-sm">{m.itself}</div>
                            <div>
                              <Button
                                size="sm"
                                onClick={() => {
                                  // select vocab then pre-select meaning so user needs only one click
                                  (async () => {
                                    try {
                                      await selectVocabForActiveRow(
                                        v.id,
                                        v.itself
                                      );
                                      selectMeaningForRow(m.id, m.itself);
                                    } catch {
                                      // ignore - selectVocabForActiveRow handles messaging
                                    }
                                  })();
                                }}
                              >
                                Select
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-auto">
                {privateVocabs.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between p-2 rounded hover:bg-muted"
                  >
                    <div>{v.itself}</div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => selectVocabForActiveRow(v.id, v.itself)}
                      >
                        Select
                      </Button>
                    </div>
                  </li>
                ))}
                {!privateVocabs.length && (
                  <li className="text-xs text-muted-foreground">
                    No private vocabs found.
                  </li>
                )}
              </ul>
            )}
          </div>

          <div>
            <div className="text-sm mb-1">Meanings for selected vocab</div>
            {!meaningsForSelectedVocab.length ? (
              <div className="text-xs text-muted-foreground">
                Select a vocab to list meanings.
              </div>
            ) : (
              <ul className="space-y-1">
                {meaningsForSelectedVocab.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between p-2 rounded hover:bg-muted"
                  >
                    <div
                      className={`${isMeaningChosenElsewhere(m.id) ? "opacity-50" : ""}`}
                    >
                      {m.itself}
                    </div>
                    <div>
                      <Button
                        size="sm"
                        disabled={isMeaningChosenElsewhere(m.id)}
                        onClick={() => selectMeaningForRow(m.id, m.itself)}
                      >
                        Choose
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 font-semibold">Level</div>
        <div className="mb-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full text-left">
                {pageLevelId
                  ? (levels.find((l) => l.id === pageLevelId)?.itself ??
                    `Level ${pageLevelId}`)
                  : userSettingsLevelId
                    ? (levels.find((l) => l.id === userSettingsLevelId)
                        ?.itself ?? `Level ${userSettingsLevelId}`)
                    : "No level selected"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Select level</DropdownMenuLabel>
              {levels.map((l) => (
                <DropdownMenuItem
                  key={l.id}
                  onClick={() => setPageLevelId(l.id)}
                >
                  {l.itself}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => setPageLevelId(null)}>
                No level
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mb-2 font-semibold">Instructions</div>
        <Textarea
          value={instructions}
          onChange={(e) =>
            setInstructions((e.target as HTMLTextAreaElement).value)
          }
          placeholder="Enter instructions for the reading material"
        />
      </div>

      <div className="flex gap-2 mt-4">
        <Button
          onClick={handleCreateReading}
          disabled={!allRowsValid() || creating || pageLevelId == null}
        >
          {creating ? "Working..." : "Create Reading material"}
        </Button>
        <Button variant="destructive" onClick={handleDeleteClick}>
          {rlItem.l_item_id ? "Delete request" : "Delete"}
        </Button>
      </div>

      {/* Confirm delete dialog for owners */}
      <AlertDialog open={showConfirmDelete} onOpenChange={setShowConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete reading/listening item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this reading/listening item? If
              listening material exists it will instead raise a delete request.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowConfirmDelete(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="mt-6 border p-4 rounded bg-muted/10">
        <div className="font-semibold mb-2">Generated Reading Text</div>
        <div className="whitespace-pre-wrap text-sm">
          {rlItem.r_item ?? "No generated reading yet."}
        </div>
      </div>
    </div>
  );
}
