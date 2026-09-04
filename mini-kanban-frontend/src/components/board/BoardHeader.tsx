"use client";

import Link from "next/link";
import { Avatar, Button } from "@/components/ui";
import type { Board, BoardMember } from "@/lib/types";

const MAX_SHOWN = 5;

/**
 * `BoardHeader` — title, members, share button (frontend ROADMAP Phase 6).
 * Sits below the app-shell `Header` on the wood ground, so it uses the same
 * "page H1" type role the boards list's `<h1>` does (`DESIGN §3`).
 */
export function BoardHeader({
  board,
  members,
  onShare,
}: {
  board: Board;
  members: BoardMember[] | undefined;
  onShare: () => void;
}) {
  const shown = members?.slice(0, MAX_SHOWN) ?? [];
  const overflow = (members?.length ?? 0) - shown.length;

  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-[30px] pt-8">
      <div>
        <Link
          href="/boards"
          className="font-courier text-[11px] text-[rgba(255,240,220,.6)] hover:text-[rgba(255,240,220,.85)]"
        >
          ← your boards
        </Link>
        <h1 className="mt-1 font-archivo text-[32px] font-bold leading-[1.1] tracking-[-.022em] text-[#F6EFE3]">
          {board.title}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center" aria-label="Board members">
          {shown.map((m, i) => (
            <Avatar
              key={m.userId}
              name={m.user.name}
              className={i === 0 ? "ring-2 ring-wood" : "-ml-2 ring-2 ring-wood"}
            />
          ))}
          {overflow > 0 && (
            <span className="-ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(255,255,255,.15)] font-archivo text-[10px] font-bold text-[#F6EFE3] ring-2 ring-wood">
              +{overflow}
            </span>
          )}
        </div>
        <Button variant="desk" onClick={onShare}>
          Share
        </Button>
      </div>
    </header>
  );
}
