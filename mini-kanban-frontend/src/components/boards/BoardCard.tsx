"use client";

import Link from "next/link";
import type { Board } from "@/lib/types";

/**
 * A board on the shelf: the angle-cut manila tab of DESIGN §4.2 over an index
 * card body from §4.4. The boards list isn't specified in DESIGN.md, so per
 * §1 it is derived from the same tokens the board view uses — a folder, seen
 * closed, is the honest object for "a board you haven't opened yet".
 *
 * Motion follows §5 exactly: hover lifts 1px on `transform` only, and the
 * shadow blooms as the *opacity* of an `::after` layer rather than a
 * `box-shadow` transition.
 */
const ROLE_LABEL: Record<string, string> = {
  OWNER: "owner",
  EDITOR: "editor",
  VIEWER: "viewer",
};

/** Kind colours live on the `filed` label and nowhere else (DESIGN §4.4). */
const ROLE_COLOR: Record<string, string> = {
  OWNER: "text-moss",
  EDITOR: "text-blue",
  VIEWER: "text-faint",
};

function filedOn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function BoardCard({ board }: { board: Board }) {
  const role = board.role ?? "VIEWER";
  const pending = board.pending === true;

  const body = (
    <>
      {/* Tab — clip-path and radius from DESIGN §4.2, at tile scale. */}
      <span
        aria-hidden
        className="block h-[22px] w-[112px] rounded-tab bg-gradient-to-b from-manila to-manila-2 shadow-[0_-1px_0_rgba(255,255,255,.4)_inset]"
        style={{ clipPath: "polygon(0 0, calc(100% - 11px) 0, 100% 100%, 0 100%)" }}
      />

      {/* Card body: the §4.4 index card — red header rule at 22px, 21px ruling
          from 24px. The 21px title line-height is what those lines align to. */}
      <span
        className="relative -mt-px block rounded-[0_3px_3px_3px] border border-card-edge bg-card px-[13px] pb-[11px] pt-[29px]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(178,66,52,.5) 0 1px, transparent 1px), repeating-linear-gradient(rgba(47,92,134,.08) 0 1px, transparent 1px 21px)",
          backgroundPosition: "0 22px, 0 24px",
          backgroundRepeat: "no-repeat, repeat",
          boxShadow:
            "0 1px 0 rgba(255,255,255,.8) inset, 0 3px 6px -3px rgba(20,14,8,.5)",
        }}
      >
        <span
          className={`absolute left-[13px] top-[5px] font-courier text-[9.5px] font-bold uppercase tracking-[.14em] ${
            ROLE_COLOR[role] ?? "text-faint"
          }`}
        >
          {pending ? "filing…" : (ROLE_LABEL[role] ?? "member")}
        </span>

        <span className="block font-courier text-[13px] font-bold leading-[21px] text-ink">
          {board.title}
        </span>

        {board.description && (
          <span className="mt-px block truncate font-courier text-[11px] leading-[21px] text-pencil">
            {board.description}
          </span>
        )}

        <span className="mt-2 block border-t border-hair pt-2">
          <span className="flex items-center gap-2 font-courier text-[11px] text-faint">
            filed {filedOn(board.createdAt)}
          </span>
        </span>
      </span>
    </>
  );

  // A placeholder row has no real id yet, so it must not be a link — clicking
  // it would 404 on a board the server hasn't acknowledged.
  if (pending) {
    return (
      <li aria-busy className="block opacity-60">
        {body}
      </li>
    );
  }

  return (
    <li>
      <Link
        href={`/boards/${board.id}`}
        className="group relative block transition-transform duration-hover ease-paper hover:-translate-y-px"
      >
        {body}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[3px] opacity-0 shadow-lift transition-opacity duration-hover ease-paper group-hover:opacity-100"
        />
      </Link>
    </li>
  );
}
