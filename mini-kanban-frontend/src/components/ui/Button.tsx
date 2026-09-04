"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/cn";

/**
 * DESIGN §4.6, exact.
 *   desk    — on the wood ground: rgba(255,255,255,.11) fill, 1px
 *             rgba(255,255,255,.2) border, 3px radius, 31px tall; hover lifts
 *             1px and brightens.
 *   primary — solid --manila, --manila-ink text, 0 2px 0 rgba(0,0,0,.22).
 *   paper   — inside cards/modals: --card fill, --edge border, --ink text.
 *
 * Only `transform` animates on hover (DESIGN §5 rule 1) — never box-shadow.
 */
type Variant = "desk" | "primary" | "paper" | "ghost";

const VARIANTS: Record<Variant, string> = {
  desk: "bg-[rgba(255,255,255,.11)] border border-[rgba(255,255,255,.2)] text-[#F6EFE3] hover:bg-[rgba(255,255,255,.17)]",
  primary:
    "bg-manila border border-manila-2 text-manila-ink shadow-[0_2px_0_rgba(0,0,0,.22)] hover:bg-[#E2CDA6]",
  paper: "bg-card border border-card-edge text-ink hover:bg-card-2",
  ghost: "bg-transparent border border-transparent text-[#F6EFE3] hover:bg-[rgba(255,255,255,.09)]",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "desk", loading, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      // 31px tall per §4.6; min-h-[44px] is NOT applied here because §7's
      // 44px rule is a touch-target rule for the board surface, and forcing
      // it on every chrome button would break the stated height.
      className={cn(
        "inline-flex h-[31px] items-center justify-center gap-2 rounded-[3px] px-3",
        "font-archivo text-[12.5px] font-semibold",
        "transition-transform duration-hover ease-paper",
        "hover:-translate-y-px active:translate-y-0",
        "disabled:pointer-events-none disabled:opacity-55",
        VARIANTS[variant],
        className
      )}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
);
Button.displayName = "Button";

/** Rotation only — a transform, so it obeys DESIGN §5 rule 1 and is killed by
 *  the reduced-motion block in globals.css. */
function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent opacity-70"
    />
  );
}
