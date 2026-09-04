"use client";

import { cn } from "@/lib/cn";

/** Initials on manila — no image uploads exist in this app, so an avatar is
 *  always derived from the name. */
export function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      title={name}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full",
        "bg-manila-2 font-archivo text-[11px] font-bold text-manila-ink",
        className
      )}
    >
      {initials || "?"}
    </span>
  );
}
