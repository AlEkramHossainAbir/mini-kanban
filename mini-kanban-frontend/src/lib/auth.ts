"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { get, post } from "./api";
import type { User } from "./types";

/** The app shell's "who am I". `skipAuthRetry` matters: on a cold load a 401
 *  here means "not logged in", which is a normal answer — without it the
 *  interceptor would try to refresh and bounce the visitor to /login from
 *  pages that are legitimately public. */
export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => get<User>("/api/v1/auth/me", { skipAuthRetry: true }),
    enabled,
    retry: false,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => post<{ success: true }>("/api/v1/auth/logout"),
    // Clear on settled, not just success: if logout fails server-side the
    // local session is still gone as far as the user is concerned, and
    // leaving a stale cache behind would show a logged-in shell.
    onSettled: () => {
      qc.clear();
      router.replace("/login");
      router.refresh();
    },
  });
}
