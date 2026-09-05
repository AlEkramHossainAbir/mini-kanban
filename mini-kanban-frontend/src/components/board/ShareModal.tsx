"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Avatar, Button, ConfirmDialog, Input, Modal } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  useAddMember,
  useBoardMembers,
  useInviteCandidates,
  useRemoveMember,
  useUpdateMemberRole,
} from "@/lib/members";
import { addMemberSchema, type AddMemberValues } from "@/lib/schemas";
import type { BoardMember, BoardRole } from "@/lib/types";

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

/** EDITOR ⇄ VIEWER only — same narrowing `addMemberSchema` applies to the
 *  invite form. Ownership changes/transfers stay out of this modal. */
type AssignableRole = Extract<BoardRole, "EDITOR" | "VIEWER">;

/**
 * One member row. OWNER rows are display-only (no self-demotion, no removing
 * a board's last owner from here — `assertLastOwnerSafe` on the server would
 * just reject it anyway); EDITOR/VIEWER rows get a role select and a remove
 * button once an OWNER opens the modal.
 */
function MemberRow({
  member,
  isOwner,
  onRoleChange,
  roleChangePending,
  onRemove,
}: {
  member: BoardMember;
  isOwner: boolean;
  onRoleChange: (role: AssignableRole) => void;
  roleChangePending: boolean;
  onRemove: () => void;
}) {
  const canManage = isOwner && member.role !== "OWNER";

  return (
    <li className="flex items-center gap-2.5">
      <Avatar name={member.user.name} />
      <span className="min-w-0 flex-1 truncate font-archivo text-[12.5px] text-ink">
        {member.user.name}
        <span className="ml-1.5 text-faint">{member.user.email}</span>
      </span>

      {canManage ? (
        <>
          <select
            aria-label={`Role for ${member.user.name}`}
            className="h-[28px] rounded-[3px] border border-card-edge bg-card px-1.5 font-courier text-[10.5px] font-bold uppercase tracking-[.1em] text-ink disabled:opacity-55"
            value={member.role}
            disabled={roleChangePending}
            onChange={(e) => onRoleChange(e.target.value as AssignableRole)}
          >
            <option value="EDITOR">Editor</option>
            <option value="VIEWER">Viewer</option>
          </select>
          <button
            type="button"
            aria-label={`Remove ${member.user.name} from this board`}
            onClick={onRemove}
            className="relative rounded-[2px] p-1 text-faint transition-colors duration-hover before:absolute before:inset-[-10px] before:content-[''] hover:text-rule"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </>
      ) : (
        <span
          className={`font-courier text-[10.5px] font-bold uppercase tracking-[.1em] ${ROLE_COLOR[member.role]}`}
        >
          {ROLE_LABEL[member.role]}
        </span>
      )}
    </li>
  );
}

/**
 * The board's "share" dialog (frontend ROADMAP Phase 6). Every member can
 * open it and see who has access (`GET .../members` is member-only, not
 * OWNER-only, per PLAN §3's route table) — only an OWNER sees the invite
 * form and per-row role/remove controls, since every mutating members route
 * is OWNER-only server-side and showing them to anyone else would just
 * collect input for a guaranteed `403`.
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
  const updateRole = useUpdateMemberRole(boardId);
  const removeMember = useRemoveMember(boardId);
  const [removing, setRemoving] = useState<BoardMember | null>(null);

  // Otherwise a stale `removing` from a prior visit would keep the just-
  // reopened share Modal permanently masked by the (invisible, since `open`
  // was false) confirm step's `open && removing !== null` gate.
  useEffect(() => {
    if (!open) setRemoving(null);
  }, [open]);

  const form = useForm<AddMemberValues>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { email: "", role: "EDITOR" },
    mode: "onSubmit",
  });

  // Debounced so every keystroke doesn't fire its own request — 200ms is
  // short enough to feel live, long enough to collapse a fast typist's
  // keystrokes into one call per pause.
  const emailValue = form.watch("email");
  const [debouncedEmail, setDebouncedEmail] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedEmail(emailValue.trim()), 200);
    return () => clearTimeout(t);
  }, [emailValue]);
  const { data: candidates } = useInviteCandidates(
    boardId,
    debouncedEmail,
    isOwner && open
  );

  const submit = form.handleSubmit((values) => {
    addMember.mutate(values, {
      onSuccess: () => {
        toast.success(`${values.email} can now access this board`);
        form.reset({ email: "", role: "EDITOR" });
        setDebouncedEmail("");
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

  const changeRole = (userId: string, role: AssignableRole) => {
    updateRole.mutate(
      { userId, role },
      {
        onError: (error) => {
          toast.error(
            error instanceof ApiError ? error.message : "Could not change that member's role."
          );
        },
      }
    );
  };

  const confirmRemove = () => {
    if (!removing) return;
    removeMember.mutate(removing.userId, {
      onSuccess: () => {
        toast.success(`${removing.user.name} no longer has access to this board`);
        setRemoving(null);
      },
      onError: (error) => {
        toast.error(
          error instanceof ApiError ? error.message : "Could not remove that member."
        );
        setRemoving(null);
      },
    });
  };

  return (
    <>
      {/* `open && removing === null`, not just `open`: rendered as a sibling
       *  of the ConfirmDialog below rather than nested inside it, matching
       *  `EditTaskModal`'s pattern — only one `Modal` is ever mounted at a
       *  time, so neither's focus trap or Escape handling fights the other. */}
      <Modal open={open && removing === null} onClose={onClose} title="Share board">
        <ul className="flex max-h-[240px] flex-col gap-2.5 overflow-y-auto">
          {isLoading &&
            [0, 1, 2].map((i) => (
              <li key={i} className="h-9 animate-pulse rounded-[3px] bg-card-2" />
            ))}
          {members?.map((m) => (
            <MemberRow
              key={m.userId}
              member={m}
              isOwner={isOwner}
              roleChangePending={
                updateRole.isPending && updateRole.variables?.userId === m.userId
              }
              onRoleChange={(role) => changeRole(m.userId, role)}
              onRemove={() => setRemoving(m)}
            />
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
              list="invite-candidates"
              error={form.formState.errors.email?.message}
              {...form.register("email")}
            />
            {/* Native suggestion list — registered users matching what's
                typed so far (`GET .../members/candidates`). No custom
                dropdown/combo widget: a `<datalist>` gets keyboard/screen-
                reader support for free from the browser, which a hand-rolled
                one would have to rebuild from scratch. */}
            <datalist id="invite-candidates">
              {candidates?.map((u) => (
                <option key={u.id} value={u.email}>
                  {u.name}
                </option>
              ))}
            </datalist>

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

      <ConfirmDialog
        open={open && removing !== null}
        title="Remove member"
        description={
          removing
            ? `${removing.user.name} will lose access to this board immediately.`
            : ""
        }
        confirmLabel="Remove"
        loading={removeMember.isPending}
        onConfirm={confirmRemove}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}
