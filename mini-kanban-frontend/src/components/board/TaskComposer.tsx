"use client";

import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { useCreateTask } from "@/lib/tasks";

/**
 * The inline "add a card" composer at a column's foot (frontend ROADMAP
 * Phase 9). Title only — a new card's description is added afterwards via
 * `EditTaskModal`, the same "create now, refine later" shape as a physical
 * index card: you write the title first and file it.
 *
 * Deliberately not wired through `react-hook-form`/zod like the modals: the
 * only client-side rule worth enforcing here is "non-empty," the same bar
 * `CreateBoardModal` holds its title to, and the composer stays open after a
 * submit so adding several cards in a row never needs to be re-opened.
 */
export function TaskComposer({ columnId, boardId }: { columnId: string; boardId: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const createTask = useCreateTask(boardId);
  const ref = useRef<HTMLTextAreaElement>(null);

  const close = () => {
    setOpen(false);
    setValue("");
  };

  const submit = () => {
    const title = value.trim();
    if (!title) {
      close();
      return;
    }
    createTask.mutate({ columnId, title });
    setValue("");
    // Stays open, refocused, so filing several cards in a row is one
    // continuous flow rather than a re-open per card.
    ref.current?.focus();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-[3px] border-[1.5px] border-dashed border-[rgba(255,247,230,.3)] px-2.5 py-2 font-courier text-[12px] text-[rgba(255,247,230,.65)] transition-colors duration-hover hover:border-[rgba(255,247,230,.5)] hover:text-[rgba(255,247,230,.9)]"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        add a card
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={ref}
        autoFocus
        rows={2}
        maxLength={200}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        placeholder="Title this card…"
        className="resize-none rounded-[3px] border border-card-edge bg-card px-2.5 py-2 font-courier text-[12.5px] text-ink placeholder:text-faint"
      />
      <div className="flex items-center gap-2">
        <Button type="button" variant="primary" loading={createTask.isPending} onClick={submit}>
          Add card
        </Button>
        <Button type="button" variant="paper" onClick={close}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
