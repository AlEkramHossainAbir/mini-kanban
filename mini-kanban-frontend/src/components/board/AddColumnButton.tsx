"use client";

import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { useCreateColumn } from "@/lib/columns";

/**
 * The board strip's own "add column" affordance (frontend ROADMAP Phase 9) —
 * sits at the end of the horizontal scroll container, same `280px` width as
 * a real column (`DESIGN §4.1`) so it reads as the next folder in the
 * cabinet rather than a stray control.
 */
export function AddColumnButton({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const createColumn = useCreateColumn(boardId);
  const ref = useRef<HTMLInputElement>(null);

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
    createColumn.mutate({ title });
    close();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-[280px] flex-shrink-0 items-center justify-center gap-1.5 self-start rounded-[6px] border-[1.5px] border-dashed border-[rgba(255,247,230,.3)] font-archivo text-[12px] font-bold uppercase tracking-[.1em] text-[rgba(255,247,230,.6)] transition-colors duration-hover hover:border-[rgba(255,247,230,.5)] hover:text-[rgba(255,247,230,.85)]"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        add column
      </button>
    );
  }

  return (
    <div className="flex w-[280px] flex-shrink-0 flex-col gap-2 self-start">
      <input
        ref={ref}
        autoFocus
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        placeholder="Column name"
        className="h-9 rounded-[3px] border border-[rgba(255,255,255,.25)] bg-[rgba(255,255,255,.08)] px-3 font-archivo text-[13px] text-[#F6EFE3] placeholder:text-[rgba(255,247,230,.45)]"
      />
      <div className="flex gap-2">
        <Button type="button" variant="desk" loading={createColumn.isPending} onClick={submit}>
          Add
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
