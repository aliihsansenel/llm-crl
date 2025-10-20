import { useState } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Alert, AlertDescription } from "../components/ui/alert";
import { useNavigate } from "react-router-dom";
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
} from "../lib/supabase";

export default function AuthPage() {
  const [active, setActive] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await signInWithEmail(email, password);
    if (res.error) {
      setMessage(res.error.message || "Login failed");
      return;
    }
    // on success navigate to vocabs
    navigate("/vocabs", { replace: true });
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await signUpWithEmail(email, password);
    if (res.error) {
      setMessage(res.error.message || "Signup failed");
      return;
    }
    setMessage("Signed up. Please check your email to confirm.");
  }

  async function handleGoogleOAuth() {
    setMessage(null);
    try {
      const res = await signInWithGoogle();
      // Normalize response type safely without using `any`
      const typed = res as unknown as
        | { error?: { message?: string } }
        | undefined;
      if (typed?.error) {
        setMessage(typed.error.message ?? "Google sign-in failed");
      }
      // If redirect does not occur (popup) we may need to handle session, but typically redirect happens.
    } catch (err: unknown) {
      const messageText =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Google sign-in failed";
      setMessage(messageText);
    }
  }

  return (
    <div className="max-w-md mx-auto p-6">
      <Tabs
        value={active}
        onValueChange={(v: string) =>
          setActive(v === "signup" ? "signup" : "login")
        }
      >
        <TabsList>
          <TabsTrigger value="login">Login</TabsTrigger>
          <TabsTrigger value="signup">Sign up</TabsTrigger>
        </TabsList>

        <TabsContent value="login">
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <label className="text-sm">Email</label>
            <Input
              value={email}
              onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
              className="w-full"
            />
            <label className="text-sm">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) =>
                setPassword((e.target as HTMLInputElement).value)
              }
              className="w-full"
            />
            <Button type="submit">Login</Button>
          </form>

          <div className="mt-4">
            <div className="text-center text-sm text-muted-foreground mb-2">
              Or continue with
            </div>
            <Button
              variant="outline"
              onClick={handleGoogleOAuth}
              className="w-full"
            >
              Sign in with Google
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="signup">
          <form onSubmit={handleSignup} className="flex flex-col gap-3">
            <label className="text-sm">Email</label>
            <Input
              value={email}
              onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
              className="w-full"
            />
            <label className="text-sm">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) =>
                setPassword((e.target as HTMLInputElement).value)
              }
              className="w-full"
            />
            <Button type="submit">Sign up</Button>
          </form>

          <div className="mt-4">
            <div className="text-center text-sm text-muted-foreground mb-2">
              Or continue with
            </div>
            <Button
              variant="outline"
              onClick={handleGoogleOAuth}
              className="w-full"
            >
              Sign up with Google
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {message && (
        <Alert className="mt-4">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
