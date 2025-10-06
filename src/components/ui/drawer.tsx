import * as React from "react";
import { cn } from "@/lib/utils";

type DrawerContextType = {
  open: boolean;
  setOpen: (open: boolean) => void;
  isDesktop: boolean;
};

const DrawerContext = React.createContext<DrawerContextType | null>(null);

export function useDrawer() {
  const ctx = React.useContext(DrawerContext);
  if (!ctx) throw new Error("useDrawer must be used within Drawer");
  return ctx;
}

export function Drawer({
  children,
  open,
  defaultOpen,
  onOpenChange,
  className,
}: {
  children?: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [isDesktop, setIsDesktop] = React.useState(false);
  React.useEffect(() => {
    const m = window.matchMedia("(min-width: 768px)");
    setIsDesktop(m.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    m.addEventListener?.("change", handler);
    return () => m.removeEventListener?.("change", handler);
  }, []);

  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? !!open : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };

  return (
    <DrawerContext.Provider value={{ open: currentOpen, setOpen, isDesktop }}>
      <div data-slot="drawer" className={cn("relative flex", className)}>
        {children}
      </div>
    </DrawerContext.Provider>
  );
}

export function DrawerTrigger({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: React.ReactNode;
}) {
  const ctx = React.useContext(DrawerContext);
  return (
    <button
      type="button"
      data-slot="drawer-trigger"
      {...rest}
      onClick={(e) => {
        e.stopPropagation();
        rest.onClick?.(e);
        // toggle drawer instead of always opening so trigger can both open and close
        ctx?.setOpen?.(!ctx?.open);
      }}
    >
      {children}
    </button>
  );
}

export function DrawerClose({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: React.ReactNode;
}) {
  const ctx = React.useContext(DrawerContext);
  return (
    <button
      type="button"
      aria-label="Close drawer"
      data-slot="drawer-close"
      {...rest}
      onClick={(e) => {
        e.stopPropagation();
        rest.onClick?.(e);
        ctx?.setOpen?.(false);
      }}
    >
      {children}
    </button>
  );
}

export function DrawerOverlay({ className }: { className?: string }) {
  const ctx = React.useContext(DrawerContext);
  if (!ctx || ctx.isDesktop || !ctx.open) return null;
  return (
    <div
      data-slot="drawer-overlay"
      className={cn("fixed inset-0 z-40 bg-black/50 md:hidden", className)}
      onClick={() => ctx.setOpen?.(false)}
      aria-hidden
    />
  );
}

export function DrawerContent({
  children,
  className,
  style,
}: {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ctx = React.useContext(DrawerContext);
  const open = ctx?.open ?? false;

  // On mobile we want the overlay behavior (DrawerOverlay handles clicks).
  // On desktop we keep the drawer in layout flow (md:static) but allow collapsing:
  // use responsive translate classes so md viewport also respects `open`.
  const translateClass = open
    ? "translate-x-0 md:translate-x-0"
    : "-translate-x-full md:-translate-x-full";

  return (
    <>
      <DrawerOverlay />
      <aside
        data-slot="drawer-content"
        className={cn(
          "fixed left-0 top-0 z-50 h-full w-64 transform bg-background shadow-lg transition-transform duration-200 md:static md:shadow-none",
          translateClass,
          "md:block",
          className
        )}
        style={style}
        aria-hidden={!open}
      >
        <div className="h-full flex flex-col">{children}</div>
      </aside>
    </>
  );
}

export function DrawerHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 md:gap-1.5 md:text-left",
        className
      )}
      {...props}
    />
  );
}

export function DrawerFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

export function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  );
}

export function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export default Drawer;
