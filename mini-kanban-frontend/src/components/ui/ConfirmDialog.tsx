"use client";

import { Button } from "./Button";
import { Modal } from "./Modal";

/**
 * The single reusable "are you sure" step (frontend ROADMAP Phase 9) —
 * task and column deletion both cascade with no undo (PLAN §6), so both
 * route through this rather than firing on a bare click.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="font-courier text-[12.5px] leading-[1.5] text-pencil">{description}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="paper" onClick={onClose}>
          Cancel
        </Button>
        {/* Destructive action gets --rule (the direction's red), overriding
         *  the primary variant's manila fill — the only place in the app a
         *  button reads as "undoable-not". */}
        <Button
          type="button"
          variant="primary"
          className="border-rule bg-rule text-[#F6EFE3] shadow-none hover:bg-[#9C3B2E]"
          loading={loading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
