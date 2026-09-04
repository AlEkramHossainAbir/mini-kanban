"use client";

import { useState } from "react";
import { BoardCard } from "@/components/boards/BoardCard";
import { CreateBoardModal } from "@/components/boards/CreateBoardModal";
import { EmptyBoards } from "@/components/boards/EmptyBoards";
import { Button, Skeleton } from "@/components/ui";
import { useBoards } from "@/lib/boards";

/**
 * The boards list (frontend ROADMAP Phase 5).
 *
 * Pagination is cursor-based and explicit: a "Load more" button rather than
 * infinite scroll, which is cheaper, keyboard-reachable, and does not fetch
 * pages nobody asked for.
 */
export default function BoardsPage() {
  const [creating, setCreating] = useState(false);
  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useBoards();

  const boards = data?.pages.flatMap((page) => page.items) ?? [];
  const isEmpty = !isLoading && !isError && boards.length === 0;

  return (
    <main className="mx-auto max-w-[1420px] px-[var(--gutter)] py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-archivo text-[26px] font-bold leading-[1.1] tracking-[-.022em] text-[#F6EFE3] sm:text-[32px]">
            Your boards
          </h1>
          <p className="mt-2 font-courier text-[12.5px] text-[rgba(255,240,220,.6)]">
            {isLoading
              ? "pulling the drawer…"
              : `${boards.length} ${boards.length === 1 ? "board" : "boards"} filed`}
          </p>
        </div>

        {!isEmpty && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            New board
          </Button>
        )}
      </header>

      {isLoading && (
        <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i}>
              <BoardCardSkeleton />
            </li>
          ))}
        </ul>
      )}

      {isError && (
        <div className="mt-7 rounded-[4px] border border-[rgba(255,255,255,.16)] bg-[rgba(255,255,255,.05)] p-6">
          <p className="font-courier text-[12.5px] text-[rgba(255,240,220,.75)]">
            Could not load your boards.
          </p>
          <Button
            variant="desk"
            className="mt-3"
            loading={isRefetching}
            onClick={() => refetch()}
          >
            Try again
          </Button>
        </div>
      )}

      {isEmpty && (
        <div className="mt-7">
          <EmptyBoards onCreate={() => setCreating(true)} />
        </div>
      )}

      {boards.length > 0 && (
        <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            // Keyed by id, never by index — the same rule the board view
            // follows, and what keeps an optimistic row swapping in place
            // instead of remounting the whole list.
            <BoardCard key={board.id} board={board} />
          ))}
        </ul>
      )}

      {hasNextPage && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="desk"
            loading={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <CreateBoardModal open={creating} onClose={() => setCreating(false)} />
    </main>
  );
}

/** Tab + ruled card body, matching BoardCard's silhouette (DESIGN §4.7). */
function BoardCardSkeleton() {
  return (
    <div aria-hidden>
      <Skeleton className="h-[22px] w-[112px] rounded-tab" />
      <div
        className="-mt-px h-[104px] animate-pulse rounded-[0_3px_3px_3px] border border-card-edge bg-card-2 [animation-duration:1.6s]"
        style={{
          backgroundImage: "linear-gradient(var(--hair) 1px, transparent 1px)",
          backgroundSize: "100% 21px",
          backgroundPosition: "0 29px",
        }}
      />
    </div>
  );
}
