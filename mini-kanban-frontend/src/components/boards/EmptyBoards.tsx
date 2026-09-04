"use client";

import { Button } from "@/components/ui";

/**
 * Never a blank screen (frontend ROADMAP Phase 5): an empty drawer, one line
 * of explanation, one primary CTA and nothing else competing with it.
 *
 * The illustration is inline SVG drawn from the DESIGN §2 tokens — no icon or
 * illustration dependency, per §8's lightweight budget.
 */
export function EmptyBoards({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-[6px] border border-dashed border-[rgba(255,247,230,.34)] bg-[rgba(255,255,255,.04)] px-6 py-12 text-center">
      <svg
        aria-hidden
        width="132"
        height="92"
        viewBox="0 0 132 92"
        fill="none"
        className="mb-5"
      >
        {/* two empty folders in an open drawer */}
        <path
          d="M14 30h34l7 8h49a5 5 0 0 1 5 5v36a5 5 0 0 1-5 5H14a5 5 0 0 1-5-5V35a5 5 0 0 1 5-5Z"
          fill="var(--manila-2)"
          opacity=".55"
        />
        <path
          d="M22 20h28l6 7h44a5 5 0 0 1 5 5v39a5 5 0 0 1-5 5H22a5 5 0 0 1-5-5V25a5 5 0 0 1 5-5Z"
          fill="var(--manila)"
          opacity=".8"
        />
        <path
          d="M17 44h100v27a5 5 0 0 1-5 5H22a5 5 0 0 1-5-5V44Z"
          fill="var(--manila-2)"
          opacity=".9"
        />
        <path
          d="M17 44h100"
          stroke="var(--manila-ink)"
          strokeOpacity=".28"
          strokeWidth="1.5"
        />
        <rect
          x="52"
          y="52"
          width="30"
          height="3"
          rx="1.5"
          fill="var(--manila-ink)"
          opacity=".22"
        />
      </svg>

      <h2 className="font-archivo text-[18px] font-bold tracking-[-.01em] text-[#F6EFE3]">
        The drawer is empty
      </h2>
      <p className="mt-2 max-w-[42ch] font-courier text-[12.5px] leading-[21px] text-[rgba(255,240,220,.6)]">
        A board holds your columns and cards, and can be shared with anyone
        else who has an account.
      </p>

      <Button variant="primary" onClick={onCreate} className="mt-5">
        Create your first board
      </Button>
    </div>
  );
}
