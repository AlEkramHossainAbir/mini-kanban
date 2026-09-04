"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Avatar, Button, Input, Modal } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAddMember, useBoardMembers } from "@/lib/members";
import { addMemberSchema, type AddMemberValues } from "@/lib/schemas";
import type { BoardRole } from "@/lib/types";

const ROLE_LABEL: Record<BoardRole, string> = {
  OWNER: "owner",
  EDITOR: "editor",
  VIEWER: "viewer",
};
const ROLE_COLOR: Record<BoardRole, string> = {
  OWNER: "text-moss",
  EDITOR: "text-blue",
  VIEWER: "text-faint",
};

/**
 * The board's "share" dialog (frontend ROADMAP Phase 6). Every member can
 * open it and see who has access (`GET .../members` is member-only, not
 * OWNER-only, per PLAN §3's route table) — only an OWNER sees the invite
 * form, since `POST .../members` is OWNER-only server-side and showing the
 * form to anyone else would just collect input for a guaranteed `403`.
 *
 * Role change and removal have no UI here (or anywhere in this roadmap —
 * only "Task & column CRUD" is scheduled as Phase 9, not board-member CRUD).
 * Their endpoints already exist server-side; this modal is share-only by
 * scope, not by omission — worth adding as a follow-up if wanted.
 */
export function ShareModal({
  boardId,
  open,
  onClose,
  isOwner,
}: {
  boardId: string;
  open: boolean;
  onClose: () => void;
  isOwner: boolean;
}) {
  const { data: members, isLoading } = useBoardMembers(boardId);
  const addMember = useAddMember(boardId);

  const form = useForm<AddMemberValues>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { email: "", role: "EDITOR" },
    mode: "onSubmit",
  });

  const submit = form.handleSubmit((values) => {
    addMember.mutate(values, {
      onSuccess: () => {
        toast.success(`${values.email} can now access this board`);
        form.reset({ email: "", role: "EDITOR" });
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          if (error.status === 404) {
            form.setError("email", { message: "No registered user with that email" });
            return;
          }
          if (error.status === 409) {
            form.setError("email", { message: "Already a member of this board" });
            return;
          }
        }
        toast.error("Could not add that member.");
      },
    });
  });

  return (
    <Modal open={open} onClose={onClose} title="Share board">
      <ul className="flex max-h-[240px] flex-col gap-2.5 overflow-y-auto">
        {isLoading &&
          [0, 1, 2].map((i) => (
            <li key={i} className="h-9 animate-pulse rounded-[3px] bg-card-2" />
          ))}
        {members?.map((m) => (
          <li key={m.userId} className="flex items-center gap-2.5">
            <Avatar name={m.user.name} />
            <span className="min-w-0 flex-1 truncate font-archivo text-[12.5px] text-ink">
              {m.user.name}
              <span className="ml-1.5 text-faint">{m.user.email}</span>
            </span>
            <span
              className={`font-courier text-[10.5px] font-bold uppercase tracking-[.1em] ${ROLE_COLOR[m.role]}`}
            >
              {ROLE_LABEL[m.role]}
            </span>
          </li>
        ))}
      </ul>

      {isOwner && (
        <form
          noValidate
          onSubmit={submit}
          className="mt-4 flex flex-col gap-3 border-t border-hair pt-4"
        >
          <Input
            label="Invite by email"
            type="email"
            autoComplete="off"
            placeholder="teammate@example.com"
            error={form.formState.errors.email?.message}
            {...form.register("email")}
          />

          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 font-archivo text-[12.5px] text-pencil">
              <span>Role</span>
              <select
                className="h-[34px] rounded-[3px] border border-card-edge bg-card px-2 font-archivo text-[12.5px] text-ink"
                {...form.register("role")}
              >
                <option value="EDITOR">Editor</option>
                <option value="VIEWER">Viewer</option>
              </select>
            </label>
            <Button type="submit" variant="primary" loading={addMember.isPending}>
              Add
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
