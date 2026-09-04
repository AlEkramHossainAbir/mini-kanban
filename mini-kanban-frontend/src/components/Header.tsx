"use client";

import Link from "next/link";
import { Avatar, Button } from "@/components/ui";
import { useLogout, useMe } from "@/lib/auth";

/** App shell chrome on the wood ground (DESIGN §4.6 "desk" buttons). */
export function Header() {
  const { data: user, isLoading } = useMe();
  const logout = useLogout();

  return (
    <header className="flex items-center justify-between gap-3 border-b border-[rgba(255,255,255,.1)] px-[var(--gutter)] py-3">
      <Link
        href="/boards"
        className="font-archivo text-[15px] font-bold tracking-[-.01em] text-[#F6EFE3]"
      >
        Mini&nbsp;Kanban
      </Link>

      <div className="flex items-center gap-3">
        {isLoading ? (
          <span className="h-7 w-24 animate-pulse rounded-[3px] bg-[rgba(255,255,255,.12)]" />
        ) : user ? (
          <>
            {/* The avatar already carries the identity on a phone; the name
                beside it is the first thing to go, since it is what pushes
                "Log out" off a 360px viewport. */}
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={user.name} />
              <span className="hidden truncate font-archivo text-[12.5px] text-[rgba(255,240,220,.85)] sm:inline">
                {user.name}
              </span>
            </span>
            <Button
              variant="desk"
              onClick={() => logout.mutate()}
              loading={logout.isPending}
            >
              Log out
            </Button>
          </>
        ) : null}
      </div>
    </header>
  );
}
