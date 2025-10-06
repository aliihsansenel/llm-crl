import { StrictMode, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrowserRouter,
  RouterProvider,
  Link,
  Outlet,
  useSearchParams,
  useNavigate,
} from "react-router-dom";

import AuthPage from "./pages/Auth";
import ProfilePage from "./pages/Profile";
import VocabsPage from "./pages/Vocabs";
import ListsPage from "./pages/Lists";
import DiscoverPage from "./pages/Discover";
import VocabDetail from "./pages/VocabDetail";
import ListDetail from "./pages/ListDetail";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerClose,
} from "./components/ui/drawer";

import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuLink,
} from "./components/ui/navigation-menu";

import { Menu, UserCircle, UserX } from "@mynaui/icons-react";
import { Button } from "./components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./components/ui/alert-dialog";

import supabase from "./lib/supabase";

import "./index.css";

/**
 * Route wrappers:
 * - VocabsRoute: when query param "id" exists show VocabDetail, otherwise show VocabsPage
 * - ListsRoute: when query param "id" exists show ListDetail, otherwise show ListsPage
 *
 * This preserves existing links that use query params like /vocabs?id=123
 */
function VocabsRoute() {
  const [search] = useSearchParams();
  const id = search.get("id");
  if (id) {
    return <VocabDetail />;
  }
  return <VocabsPage />;
}

function ListsRoute() {
  const [search] = useSearchParams();
  const id = search.get("id");
  if (id) {
    return <ListDetail />;
  }
  return <ListsPage />;
}

function RootRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        navigate("/vocabs", { replace: true });
      } else {
        // For anonymous users send them to the public discover page
        navigate("/discover", { replace: true });
      }
    })();
  }, [navigate]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!mounted) return;
      if (!user) {
        navigate("/login", { replace: true });
      } else {
        setChecking(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        navigate("/login", { replace: true });
      } else {
        setChecking(false);
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [navigate]);

  if (checking) return null;
  return children;
}

function Layout() {
  const [user, setUser] = useState<any | null>(null);
  const [tokens, setTokens] = useState<{ free: number; paid: number } | null>(
    null
  );
  // Controlled drawer state so header can toggle it from outside vaul trigger
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();

  // Logout helper: confirmation handled via AlertDialog
  const [logoutOpen, setLogoutOpen] = useState(false);
  async function performLogout() {
    // close dialog immediately
    setLogoutOpen(false);
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore sign out errors */
    } finally {
      setUser(null);
      setTokens(null);
      // navigate to login page after signout
      navigate("/login", { replace: true });
    }
  }

  // Determine default drawer open based on viewport (desktop default open)
  useEffect(() => {
    const m = window.matchMedia("(min-width: 768px)");
    setDrawerOpen(m.matches);
    const onChange = (ev: MediaQueryListEvent) => setDrawerOpen(ev.matches);
    m.addEventListener?.("change", onChange);
    return () => m.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function fetchInitial() {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
      if (!mounted) return;
      setUser(currentUser ?? null);
      if (currentUser?.id) {
        const { data: tokenRow, error } = await supabase
          .from("tokens")
          .select("free,paid")
          .eq("user_id", currentUser.id)
          .maybeSingle();
        if (!error && tokenRow) {
          setTokens({ free: tokenRow.free, paid: tokenRow.paid });
        }
      }
    }

    fetchInitial();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user?.id) {
        // fetch tokens once on auth change (sign in)
        (async () => {
          try {
            const { data: tokenRow, error } = await supabase
              .from("tokens")
              .select("free,paid")
              .eq("user_id", session.user.id)
              .maybeSingle();
            if (!error && tokenRow) {
              setTokens({ free: tokenRow.free, paid: tokenRow.paid });
            }
          } catch {
            /* ignore */
          }
        })();
      } else {
        setTokens(null);
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  return (
    <div className="min-h-screen flex">
      {/* Persistent Drawer: visible by default on desktop and collapsible */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="data-[vaul-drawer-direction=left]:w-64 w-64 sm:max-w-sm">
          <DrawerHeader>
            <div className="flex items-center justify-between w-full">
              <DrawerTitle>llm-crl</DrawerTitle>
              <DrawerClose>✕</DrawerClose>
            </div>
          </DrawerHeader>

          <nav className="flex flex-col gap-2 p-4 flex-1">
            {!user ? (
              <>
                <Link to="/login" className="text-sm hover:underline">
                  Login & Sign up
                </Link>
              </>
            ) : null}

            <Link to="/profile" className="text-sm hover:underline">
              My Profile
            </Link>
            <Link to="/discover" className="text-sm hover:underline">
              Discover
            </Link>
            <Link to="/vocabs" className="text-sm hover:underline">
              My Vocabulary
            </Link>
            <Link to="/lists" className="text-sm hover:underline">
              Reading/Listening Material
            </Link>

            {user && (
              <Button
                type="button"
                onClick={() => setLogoutOpen(true)}
                className="w-full bg-black text-white text-sm text-left mt-2"
              >
                Log out
              </Button>
            )}
          </nav>

          <DrawerFooter>
            <div className="text-xs text-muted-foreground p-2">
              Signed-out view will show login/signup links on the main area.
            </div>

            <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm log out</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to log out?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={performLogout}>
                    Log out
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <main className="flex-1 flex flex-col min-h-screen">
        {/* Top navigation menu */}
        <header className="w-full border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="h-14 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Drawer menu toggle */}
                <button
                  aria-label="Toggle menu"
                  className="p-2 rounded hover:bg-accent/20"
                  onClick={() => setDrawerOpen((s) => !s)}
                >
                  <Menu className="size-5" />
                </button>
                {/* Navigation menu placed at top */}
                <NavigationMenu>
                  <NavigationMenuList className="flex gap-2">
                    <NavigationMenuLink asChild>
                      <Link to="/vocabs" className="text-sm">
                        My Vocabulary
                      </Link>
                    </NavigationMenuLink>
                    <NavigationMenuLink asChild>
                      <Link to="/lists" className="text-sm">
                        Lists
                      </Link>
                    </NavigationMenuLink>
                    <NavigationMenuLink asChild>
                      <Link to="/discover" className="text-sm">
                        Discover
                      </Link>
                    </NavigationMenuLink>
                  </NavigationMenuList>
                </NavigationMenu>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-sm">
                  Free:{" "}
                  <span className="font-medium">{tokens?.free ?? "-"}</span>
                </div>
                <div className="text-sm">
                  Paid:{" "}
                  <span className="font-medium">{tokens?.paid ?? "-"}</span>
                </div>

                <div>
                  {user ? (
                    <Link to="/profile" aria-label="Profile">
                      <UserCircle className="size-6" />
                    </Link>
                  ) : (
                    <Link to="/login" aria-label="Login">
                      <UserX className="size-6" />
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      // root redirect will navigate based on auth state
      { index: true, element: <RootRedirect /> },
      { path: "login", element: <AuthPage /> },
      { path: "signup", element: <AuthPage /> },
      {
        // only /profile requires auth
        path: "profile",
        element: <RequireAuth>{<ProfilePage />}</RequireAuth>,
      },
      // only /vocabs requires auth (and its detail view)
      { path: "vocabs", element: <RequireAuth>{<VocabsRoute />}</RequireAuth> },
      // lists and discover no longer force redirect to login here
      { path: "lists", element: <ListsRoute /> },
      {
        path: "discover",
        element: <DiscoverPage />,
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);

// Export Layout for fast-refresh / testing
export { Layout };
