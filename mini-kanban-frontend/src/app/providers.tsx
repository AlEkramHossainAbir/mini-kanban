"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { Toaster } from "sonner";
import { ApiError } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  // useState, not a module-level client: a module singleton is shared across
  // requests on the server and would leak one user's cache into another's.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // ROADMAP Phase 3
            retry: (count, error) => {
              // Retrying an auth/permission/not-found answer is pointless: the
              // 401 path is already handled by the refresh interceptor in
              // lib/api.ts, and 403/404 will not change on a second try.
              if (error instanceof ApiError && error.status < 500) return false;
              return count < 1;
            },
            refetchOnWindowFocus: false,
          },
          // Mutations are never auto-retried: the move endpoint is the one
          // that matters, and replaying it after a 409 would fight the
          // optimistic-concurrency contract instead of surfacing it (PLAN §3).
          mutations: { retry: false },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      {/* DESIGN §4.5 — manila slip, bottom-right. Styled through toastOptions
          rather than sonner's theme presets so the exact tokens survive. */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--manila)",
            color: "var(--manila-ink)",
            border: "none",
            borderLeft: "3px solid var(--blue)",
            borderRadius: "2px",
            boxShadow: "0 18px 34px -14px rgba(8,5,3,.7)",
            fontFamily: "var(--font-archivo), system-ui, sans-serif",
            fontSize: "13px",
            fontWeight: 600,
          },
        }}
      />
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
