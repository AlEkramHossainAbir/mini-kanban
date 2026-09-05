"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronDown, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
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
const ASSIGNABLE_ROLES: { value: AssignableRole; label: string }[] = [
  { value: "EDITOR", label: "Editor" },
  { value: "VIEWER", label: "Viewer" },
];

/** Where to float the menu, computed from the trigger's own screen position
 *  rather than CSS anchoring — the member list scrolls inside the modal
 *  (`overflow-y-auto`), which would otherwise clip a menu opened near the
 *  bottom of a long list. Recomputed on every scroll/resize while open so it
 *  stays glued to the trigger instead of drifting from it. */
function useAnchoredPosition(open: boolean, anchorRef: React.RefObject<HTMLElement>) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    };
    update();
    // `capture: true` so this also fires for the member list's own scroll
    // container, not just window-level scrolling.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef]);

  return pos;
}

/**
 * A member row's access control — one pill button naming the current role,
 * opening a small menu with the two assignable roles plus "Remove access".
 * Replaces an inline `<select>` + separate trash icon (cramped, and read as
 * two unrelated controls); a single menu is the pattern most sharing UIs
 * (Notion, Linear, Google Docs) converge on for exactly this job.
 *
 * Portaled to `document.body` via `useAnchoredPosition`, not rendered inline
 * — the row lives inside the modal's `overflow-y-auto` member list, which
 * would otherwise clip the menu for any row near the bottom of a long list.
 */
function RoleMenu({
  member,
  open,
  onOpenChange,
  pending,
  onRoleChange,
  onRemove,
}: {
  member: BoardMember;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onRoleChange: (role: AssignableRole) => void;
  onRemove: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(open, triggerRef);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        onOpenChange(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Access for ${member.user.name}: ${ROLE_LABEL[member.role]}`}
        disabled={pending}
        onClick={() => onOpenChange(!open)}
        className={`inline-flex items-center gap-1 rounded-[3px] border px-2 py-1 font-courier text-[10.5px] font-bold uppercase tracking-[.1em] transition-colors duration-hover disabled:opacity-55 ${ROLE_COLOR[member.role]} ${
          open ? "border-card-edge bg-card-2" : "border-transparent hover:border-card-edge hover:bg-card-2"
        }`}
      >
        {ROLE_LABEL[member.role]}
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-hover ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Change access for ${member.user.name}`}
            style={{ top: pos.top, right: pos.right }}
            className="on-paper fixed z-[60] w-[172px] rounded-[4px] border border-card-edge bg-card p-1 shadow-toast animate-menu-in"
          >
            {ASSIGNABLE_ROLES.map((role) => (
              <button
                key={role.value}
                type="button"
                role="menuitemradio"
                aria-checked={member.role === role.value}
                onClick={() => {
                  onOpenChange(false);
                  if (member.role !== role.value) onRoleChange(role.value);
                }}
                className="flex w-full items-center justify-between rounded-[2px] px-2.5 py-1.5 text-left font-archivo text-[12.5px] text-ink transition-colors duration-hover hover:bg-card-2"
              >
                {role.label}
                {member.role === role.value && (
                  <Check className="h-3.5 w-3.5 text-blue" aria-hidden />
                )}
              </button>
            ))}
            <div role="separator" className="my-1 h-px bg-hair" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                // `flushSync`, not a plain `onOpenChange(false)` + `onRemove()`:
                // this click also swaps the share `Modal` out for
                // `ConfirmDialog`, and Framer Motion's `AnimatePresence`
                // freezes the exiting `Modal`'s *last committed* subtree for
                // its ~300ms exit — including this portaled menu, which would
                // otherwise still be sitting open, frozen mid-frame, on top of
                // the confirm dialog that just appeared. Forcing the
                // menu-closed state into its own commit first means that by
                // the time `onRemove` triggers the swap, the snapshot
                // `AnimatePresence` freezes already has the menu closed.
                flushSync(() => onOpenChange(false));
                onRemove();
              }}
              className="flex w-full items-center gap-1.5 rounded-[2px] px-2.5 py-1.5 text-left font-archivo text-[12.5px] font-semibold text-rule transition-colors duration-hover hover:bg-[rgba(178,66,52,.09)]"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Remove access
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * One member row. OWNER rows are display-only (no self-demotion, no removing
 * a board's last owner from here — `assertLastOwnerSafe` on the server would
 * just reject it anyway); EDITOR/VIEWER rows get the `RoleMenu` once an
 * OWNER opens the modal.
 */
function MemberRow({
  member,
  isOwner,
  menuOpen,
  onMenuOpenChange,
  onRoleChange,
  roleChangePending,
  onRemove,
}: {
  member: BoardMember;
  isOwner: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
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
        <RoleMenu
          member={member}
          open={menuOpen}
          onOpenChange={onMenuOpenChange}
          pending={roleChangePending}
          onRoleChange={onRoleChange}
          onRemove={onRemove}
        />
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
 * form and per-row `RoleMenu`, since every mutating members route is
 * OWNER-only server-side and showing them to anyone else would just collect
 * input for a guaranteed `403`.
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
  // Only one row's menu open at a time — opening a new one closes whichever
  // was already open, same as any native menu bar.
  const [openMenuUserId, setOpenMenuUserId] = useState<string | null>(null);

  // Otherwise stale `removing`/`openMenuUserId` from a prior visit would
  // either keep the just-reopened share Modal permanently masked by the
  // (invisible, since `open` was false) confirm step's gate, or leave a menu
  // marked open with no trigger left mounted to anchor it to.
  useEffect(() => {
    if (!open) {
      setRemoving(null);
      setOpenMenuUserId(null);
    }
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
              menuOpen={openMenuUserId === m.userId}
              onMenuOpenChange={(next) => setOpenMenuUserId(next ? m.userId : null)}
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
