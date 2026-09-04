"use client";

import Link from "next/link";
import { Avatar, Button } from "@/components/ui";
import type { RealtimeStatus } from "@/lib/realtime";
import type { Board, BoardMember } from "@/lib/types";

const MAX_SHOWN = 5;

/** Not specified in `DESIGN.md` (frontend ROADMAP Phase 10 predates any
 *  design pass over it) — derived from the same tokens per §1: `--moss` is
 *  already the done/success accent, `--amber` already reads as "in
 *  progress"/warning elsewhere in the app. Quiet by design: "live" is the
 *  steady state and shouldn't compete with the title, "reconnecting" is the
 *  one state worth a viewer's attention. */
function RealtimeIndicator({ status }: { status: RealtimeStatus }) {
  if (status === "connecting") return null;
  const live = status === "live";
  return (
    <span className="flex items-center gap-1.5 font-courier text-[11px] text-[rgba(255,240,220,.6)]">
      <span
        className={`h-[6px] w-[6px] rounded-full ${
          live ? "bg-moss" : "animate-pulse bg-amber"
        }`}
        aria-hidden="true"
      />
      {live ? "live" : status === "offline" ? "offline" : "reconnecting…"}
    </span>
  );
}

/**
 * `BoardHeader` — title, members, share button (frontend ROADMAP Phase 6);
 * the realtime indicator is Phase 10.
 * Sits below the app-shell `Header` on the wood ground, so it uses the same
 * "page H1" type role the boards list's `<h1>` does (`DESIGN §3`).
 */
export function BoardHeader({
  board,
  members,
  onShare,
  realtimeStatus,
}: {
  board: Board;
  members: BoardMember[] | undefined;
  onShare: () => void;
  realtimeStatus?: RealtimeStatus;
}) {
  const shown = members?.slice(0, MAX_SHOWN) ?? [];
  const overflow = (members?.length ?? 0) - shown.length;

  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-[var(--gutter)] pt-8">
      <div className="min-w-0">
        <Link
          href="/boards"
          className="font-courier text-[11px] text-[rgba(255,240,220,.6)] hover:text-[rgba(255,240,220,.85)]"
        >
          ← your boards
        </Link>
        {/* `break-words`, not `truncate`: a board title is user-supplied and
            a long one on a phone should wrap onto a second line rather than
            be cut off — the strip below it is the only thing on this screen
            that is allowed to scroll sideways. */}
        <h1 className="mt-1 break-words font-archivo text-[26px] font-bold leading-[1.1] tracking-[-.022em] text-[#F6EFE3] sm:text-[32px]">
          {board.title}
        </h1>
        {realtimeStatus && (
          <div className="mt-1.5">
            <RealtimeIndicator status={realtimeStatus} />
          </div>
        )}
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
