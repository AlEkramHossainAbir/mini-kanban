"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "./api";
import type { BoardMember, BoardRole } from "./types";

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
