import { StrictMode, useEffect } from "react";
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
        navigate("/login", { replace: true });
      }
    })();
  }, [navigate]);
  return null;
}

function Layout() {
  return (
    <div className="min-h-screen flex">
      {/* Persistent Drawer: visible by default and collapsible */}
      <Drawer defaultOpen>
        <DrawerContent className="data-[vaul-drawer-direction=left]:w-64 w-64 sm:max-w-sm">
          <DrawerHeader>
            <div className="flex items-center justify-between w-full">
              <DrawerTitle>llm-crl</DrawerTitle>
              <DrawerClose asChild>
                <button aria-label="Close">✕</button>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <nav className="flex flex-col gap-2 p-4">
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
          </nav>

          <DrawerFooter>
            <div className="text-xs text-muted-foreground p-2">
              Signed-out view will show login/signup links on the main area.
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <main className="flex-1">
        <Outlet />
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
      { path: "profile", element: <ProfilePage /> },
      { path: "vocabs", element: <VocabsRoute /> },
      { path: "lists", element: <ListsRoute /> },
      { path: "discover", element: <DiscoverPage /> },
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
