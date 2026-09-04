"use client";

import { useQuery } from "@tanstack/react-query";
import { CardSkeleton } from "@/components/ui";
import { get } from "@/lib/api";
import type { Board, Paginated } from "@/lib/types";

/**
 * Phase 4 placeholder — enough to prove the auth round trip lands somewhere
 * real ("register → empty boards list → refresh → still logged in").
 * Phase 5 replaces this with useInfiniteQuery, the create-board modal and the
 * designed empty state.
 */
export default function BoardsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["boards"],
    queryFn: () => get<Paginated<Board>>("/api/v1/boards"),
  });

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="font-archivo text-[32px] font-bold leading-[1.1] tracking-[-.022em] text-[#F6EFE3]">
        Your boards
      </h1>

      {isLoading && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {isError && (
        <p className="mt-6 font-courier text-[12.5px] text-[rgba(255,240,220,.75)]">
          Could not load your boards.
        </p>
      )}

      {data && data.items.length === 0 && (
        <p className="mt-6 font-courier text-[12.5px] text-[rgba(255,240,220,.6)]">
          no boards filed yet
        </p>
      )}

      {data && data.items.length > 0 && (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((board) => (
            <li
              key={board.id}
              className="rounded-card border border-card-edge bg-card p-4 shadow-card"
            >
              <span className="font-courier text-[13px] font-bold leading-[21px] text-ink">
                {board.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
