"use client";

import { AnimatePresence, domAnimation, LazyMotion, m } from "framer-motion";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Paper surface on the wood ground. Framer Motion is allowed here — DESIGN §8
 * permits it for modals and toasts (and card enter/exit); what it must never
 * touch is a sortable card's `layout` prop (§6).
 *
 * `LazyMotion`/`m` instead of the full `motion` component (DESIGN §8's
 * < 200KB budget, frontend ROADMAP Phase 11) — every modal in the app routes
 * through here, so this is the one place that decision pays for the whole
 * app. `domAnimation` covers exactly what this file uses (opacity/transform
 * animations + `AnimatePresence`'s exit); drag and layout animations aren't
 * needed here and stay out of the loaded feature bundle.
 *
 * DESIGN §7: modals trap focus, close on Esc, and restore focus to whatever
 * opened them.
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  // Remember the opener so focus can go back where it came from.
  useEffect(() => {
    if (open) restoreTo.current = document.activeElement as HTMLElement | null;
    else restoreTo.current?.focus?.();
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes?.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      // Wrap at both ends — without this, Tab walks out of the dialog and
      // leaves a screen-reader user stranded on the page behind it.
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  // Move focus into the panel once it exists.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      (nodes?.[0] ?? panelRef.current)?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  // The page behind a modal must not scroll.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <LazyMotion features={domAnimation} strict>
      <AnimatePresence>
        {open && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onKeyDown={onKeyDown}
          >
            <m.div
              className="absolute inset-0 bg-[rgba(18,12,6,.55)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
            />
            <m.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              tabIndex={-1}
              // transform + opacity only (DESIGN §5 rule 1).
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 4 }}
              transition={{ duration: 0.3, ease: [0.22, 0.85, 0.28, 1] }}
              className={cn(
                "on-paper relative w-full max-w-md rounded-[4px] border border-card-edge bg-card p-5",
                // The panel, not the page, absorbs an overflowing dialog: the
                // body is locked above, so without this a tall modal (Share
                // with a long member list, Edit task with a long description)
                // had its buttons off the bottom of a phone screen with no
                // way to reach them.
                "max-h-[calc(100dvh-2rem)] overflow-y-auto",
                "shadow-[0_28px_46px_-18px_rgba(18,12,6,.66)]",
                className
              )}
            >
              <h2 className="mb-4 font-archivo text-[15px] font-bold text-ink">
                {title}
              </h2>
              {children}
            </m.div>
          </div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}
