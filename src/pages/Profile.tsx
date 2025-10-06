import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import supabase, { ensureUserResources } from "../lib/supabase";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

function errToMessage(err: unknown): string {
  if (!err) return String(err);
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = err as any;
    if (typeof e.message === "string") return e.message;
  }
  return String(err);
}

/**
 * ProfilePage
 * - /profile (own profile) or /profile?id={otherId} (other's profile)
 * - shows profile fields and settings (settings visible only for own profile)
 * - if own resources missing, ensureUserResources will create them then re-fetch
 */

type ProfileRow = {
  user_id: string;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  bio?: string | null;
};

type SettingsRow = {
  user_id: string;
  level_id?: number | null;
  auto_confirm_1: boolean;
  auto_confirm_2: boolean;
};

export default function ProfilePage() {
  const [searchParams] = useSearchParams();
  const otherId = searchParams.get("id");

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isOwn = !otherId || otherId === currentUserId;

  async function fetchCurrentUserId() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setCurrentUserId(user?.id ?? null);
    return user?.id ?? null;
  }

  async function loadProfileAndSettings(viewUserId?: string | null) {
    setLoading(true);
    setMessage(null);
    try {
      const userId = viewUserId ?? (await fetchCurrentUserId());
      if (!userId) {
        setProfile(null);
        setSettings(null);
        setLoading(false);
        return;
      }

      // If viewing own profile, ensure resources exist
      if (!otherId || otherId === userId) {
        await ensureUserResources(userId);
      }

      // fetch profile
      const profRes = await supabase
        .from("profiles")
        .select("user_id,username,first_name,last_name,bio")
        .eq("user_id", userId)
        .maybeSingle();

      if (profRes.error) throw profRes.error;
      setProfile(profRes.data ?? null);

      // fetch settings (only present for authenticated users)
      const settingsRes = await supabase
        .from("settings")
        .select("user_id,level_id,auto_confirm_1,auto_confirm_2")
        .eq("user_id", userId)
        .maybeSingle();

      if (settingsRes.error) throw settingsRes.error;
      setSettings(settingsRes.data ?? null);
    } catch (err: unknown) {
      const msg = errToMessage(err);
      setMessage(msg);
      setProfile(null);
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // initial load: decide which userId to fetch
    (async () => {
      if (otherId) {
        await loadProfileAndSettings(otherId);
      } else {
        await loadProfileAndSettings();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherId]);

  async function handleProfileSave(e?: React.FormEvent) {
    e?.preventDefault();
    if (!currentUserId || !profile) {
      setMessage("No profile to save.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          username: profile.username,
          first_name: profile.first_name,
          last_name: profile.last_name,
          bio: profile.bio,
        })
        .match({ user_id: currentUserId });

      if (error) throw error;
      setMessage("Profile saved.");
      await loadProfileAndSettings(currentUserId);
    } catch (err: unknown) {
      const msg = errToMessage(err);
      setMessage(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleSettingsSave(e?: React.FormEvent) {
    e?.preventDefault();
    if (!currentUserId || !settings) {
      setMessage("No settings to save.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      // upsert settings (ensure row exists)
      const { error } = await supabase.from("settings").upsert({
        user_id: currentUserId,
        level_id: settings.level_id ?? null,
        auto_confirm_1: settings.auto_confirm_1,
        auto_confirm_2: settings.auto_confirm_2,
      });

      if (error) throw error;
      setMessage("Settings saved.");
      await loadProfileAndSettings(currentUserId);
    } catch (err: unknown) {
      const msg = errToMessage(err);
      setMessage(msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm">Loading profile...</div>;
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-4">
        {isOwn ? "My Profile" : `Profile`}
      </h1>

      {message && <div className="mb-4 text-sm text-red-600">{message}</div>}

      {!profile ? (
        <div className="text-sm text-muted-foreground mb-4">
          Profile not found.
        </div>
      ) : (
        <form onSubmit={handleProfileSave} className="space-y-3 mb-6">
          <label className="block">
            <div className="text-sm font-medium">Username</div>
            <Input
              value={profile.username}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  username: (e.target as HTMLInputElement).value,
                })
              }
              className="mt-1 w-full"
              disabled={!isOwn}
            />
          </label>

          <label className="block">
            <div className="text-sm font-medium">First name</div>
            <Input
              value={profile.first_name ?? ""}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  first_name: (e.target as HTMLInputElement).value,
                })
              }
              className="mt-1 w-full"
              disabled={!isOwn}
            />
          </label>

          <label className="block">
            <div className="text-sm font-medium">Last name</div>
            <Input
              value={profile.last_name ?? ""}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  last_name: (e.target as HTMLInputElement).value,
                })
              }
              className="mt-1 w-full"
              disabled={!isOwn}
            />
          </label>

          <label className="block">
            <div className="text-sm font-medium">Bio</div>
            <Textarea
              value={profile.bio ?? ""}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  bio: (e.target as HTMLTextAreaElement).value,
                })
              }
              className="mt-1 w-full h-28"
              disabled={!isOwn}
            />
          </label>

          {isOwn && (
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                Save profile
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  // refresh
                  loadProfileAndSettings(currentUserId);
                }}
              >
                Refresh
              </Button>
            </div>
          )}
        </form>
      )}

      {/* Settings - only for own profile */}
      {isOwn && (
        <div className="border-t pt-4">
          <h2 className="font-semibold mb-2">Settings</h2>
          {!settings ? (
            <div className="text-sm text-muted-foreground mb-4">
              Settings not found.
            </div>
          ) : (
            <form onSubmit={handleSettingsSave} className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.auto_confirm_1}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      auto_confirm_1: e.target.checked,
                    })
                  }
                />
                <span className="text-sm">
                  Do not show delete-list confirm (auto_confirm_1)
                </span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.auto_confirm_2}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      auto_confirm_2: e.target.checked,
                    })
                  }
                />
                <span className="text-sm">
                  Another auto confirm (auto_confirm_2)
                </span>
              </label>

              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  Save settings
                </Button>
                <Button
                  variant="outline"
                  onClick={() => loadProfileAndSettings(currentUserId)}
                >
                  Refresh
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
