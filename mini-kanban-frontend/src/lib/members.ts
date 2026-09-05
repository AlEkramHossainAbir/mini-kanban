"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post } from "./api";
import type { BoardMember, BoardRole, User } from "./types";

export const membersKey = (boardId: string) =>
  ["board", boardId, "members"] as const;

/** `GET /boards/:id/members` — member-only, any role can see who has access
 *  (PLAN §3's route table). Kept as its own query rather than folded into
 *  `useBoard`, matching the two separate endpoints. */
export function useBoardMembers(boardId: string) {
  return useQuery({
    queryKey: membersKey(boardId),
    queryFn: () => get<BoardMember[]>(`/api/v1/boards/${boardId}/members`),
  });
}

/**
 * `GET /boards/:id/members/candidates?q=` — OWNER only, backs the invite
 * field's suggestions. `q` is the (debounced, trimmed) text currently typed
 * into the email input; an empty `q` is a valid call — the server just
 * returns its default short list — but the hook stays disabled until the
 * modal is actually open and the caller is an OWNER, since anyone else's
 * call would only ever come back `403`.
 */
export function useInviteCandidates(boardId: string, q: string, enabled: boolean) {
  return useQuery({
    queryKey: [...membersKey(boardId), "candidates", q] as const,
    queryFn: () =>
      get<User[]>(
        `/api/v1/boards/${boardId}/members/candidates?q=${encodeURIComponent(q)}`
      ),
    enabled,
    staleTime: 10_000,
  });
}

export interface AddMemberInput {
  email: string;
  role: BoardRole;
}

/**
 * `POST /boards/:id/members` — OWNER only; the server is the real gate, this
 * only decides whether to render the form (`ShareModal` checks `role`).
 *
 * Not optimistic: unlike the board-creation and task-move mutations, sharing
 * has no natural placeholder — the row needs the invited user's real name
 * and id, which only the server has. A refetch on success is the honest
 * version of "show the new member" here.
 */
export function useAddMember(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddMemberInput) =>
      post<BoardMember>(`/api/v1/boards/${boardId}/members`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(boardId) });
    },
  });
}

/**
 * `PATCH /boards/:id/members/:userId` — OWNER only; promotes/demotes an
 * existing member between EDITOR and VIEWER. Not optimistic, same reasoning
 * as `useAddMember`: the row count here is small enough that a refetch is
 * instant, and the server is the one place the last-owner guard (PLAN §4)
 * actually lives — an optimistic write would have to duplicate that rule
 * client-side just to roll back correctly when it fires.
 */
export function useUpdateMemberRole(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: BoardRole }) =>
      patch<BoardMember>(`/api/v1/boards/${boardId}/members/${userId}`, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(boardId) });
    },
  });
}

/** `DELETE /boards/:id/members/:userId` — OWNER only; revokes a member's
 *  access outright. Same last-owner guard and non-optimistic reasoning as
 *  `useUpdateMemberRole`. */
export function useRemoveMember(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      del<void>(`/api/v1/boards/${boardId}/members/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersKey(boardId) });
    },
  });
}
