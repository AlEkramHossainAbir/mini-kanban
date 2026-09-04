"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { get } from "./api";
import { boardKey } from "./board";
import { patchColumnFields, removeColumnFromBoard, upsertOrInsertColumn } from "./columns";
import type { MoveColumnResult } from "./columns";
import { removeTaskFromBoard, upsertOrInsertTask, upsertTaskInBoard } from "./tasks";
import type { MoveTaskResult } from "./tasks";
import type { Board, Column, Task } from "./types";

/** Same-origin for HTTP (the ws-ticket fetch goes through the Phase 2
 *  rewrite), but Socket.IO connects **directly** to the backend — a WS
 *  upgrade through the Next.js rewrite proxy is unreliable (backend Phase
 *  4's rationale for the ws-ticket in the first place). Public on purpose:
 *  unlike `BACKEND_URL`, this address is resolved by the browser itself. */
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000";

interface WsTicket {
  ticket: string;
  expiresIn: number;
}

interface TaskDeletedPayload {
  id: string;
  columnId: string;
  boardId: string;
}

interface ColumnDeletedPayload {
  id: string;
  boardId: string;
}

export type RealtimeStatus = "connecting" | "live" | "reconnecting" | "offline";

function taskVersion(board: Board, taskId: string): number | undefined {
  for (const column of board.columns ?? []) {
    const task = column.tasks.find((t) => t.id === taskId);
    if (task) return task.version;
  }
  return undefined;
}

/**
 * Live board sync (frontend ROADMAP Phase 10, PLAN §3 "Real-time sync
 * across connected clients"). One socket per mounted board page: connect,
 * fetch a fresh single-use ws-ticket for the handshake (backend Phase 4 —
 * `mk_at` is httpOnly, so it can't ride into `io({ auth })` directly, and a
 * ticket is spent the moment the gateway consumes it, so a *function* `auth`
 * is required — socket.io-client calls it fresh on every reconnect attempt,
 * never reusing a ticket that already failed), join `board:<boardId>`, then
 * reconcile the same `['board', boardId]` cache every other hook here reads
 * and writes.
 *
 * Two out-of-order guards, both PLAN §3's:
 *  - `task.moved` is applied only if its `version` is strictly newer than
 *    the cached task's — the same rule `useMoveTask`'s per-task sequence
 *    numbers enforce for the REST response, extended to this WS path. If it
 *    matches an update this client's own optimistic write already applied
 *    (or already reconciled via the REST response), the version is equal,
 *    not newer, so this is a no-op — closing PLAN §3's "matches its own
 *    in-flight update" case without needing to identify the event's sender.
 *  - On reconnect, the client refetches the whole board rather than trying
 *    to replay whatever events it missed while disconnected (simple and
 *    robust for MVP scope, per PLAN §3 — an events log is the at-scale
 *    answer, §7, not built here).
 *
 * `task.created`/`task.updated`/`column.created`/`column.updated` carry no
 * `version` (only a move bumps one, PLAN §3) and are applied unconditionally
 * — last-write-wins is the right call there, same as a plain title edit.
 */
export function useBoardRealtime(boardId: string): RealtimeStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");

  useEffect(() => {
    let cancelled = false;
    let hasConnectedOnce = false;
    setStatus("connecting");

    const socket: Socket = io(WS_URL, {
      autoConnect: false,
      auth: (cb: (data: Record<string, unknown>) => void) => {
        get<WsTicket>("/api/v1/auth/ws-ticket")
          .then((t) => cb({ ticket: t.ticket }))
          .catch(() => cb({}));
      },
    });

    const patchBoard = (fn: (old: Board) => Board) => {
      qc.setQueryData<Board>(boardKey(boardId), (old) => (old ? fn(old) : old));
    };

    socket.on("connect", () => {
      if (cancelled) return;
      if (hasConnectedOnce) {
        // Reconnected after a drop — refetch rather than replay (PLAN §3).
        qc.invalidateQueries({ queryKey: boardKey(boardId) });
      }
      hasConnectedOnce = true;
      socket.emit("join", { boardId }, (res: { error?: string } | undefined) => {
        if (cancelled) return;
        setStatus(res?.error ? "offline" : "live");
      });
    });

    socket.on("disconnect", () => {
      if (!cancelled) setStatus("reconnecting");
    });

    socket.on("connect_error", () => {
      if (!cancelled) setStatus("reconnecting");
    });

    socket.on("task.created", (task: Task) => patchBoard((b) => upsertOrInsertTask(b, task)));
    socket.on("task.updated", (task: Task) => patchBoard((b) => upsertOrInsertTask(b, task)));
    socket.on("task.moved", (result: MoveTaskResult) => {
      patchBoard((b) => {
        const current = taskVersion(b, result.id);
        if (current !== undefined && result.version <= current) return b;
        return upsertTaskInBoard(b, result);
      });
    });
    socket.on("task.deleted", (p: TaskDeletedPayload) =>
      patchBoard((b) => removeTaskFromBoard(b, p.id))
    );

    socket.on("column.created", (column: Column) =>
      patchBoard((b) => upsertOrInsertColumn(b, column))
    );
    socket.on("column.updated", (column: Column) =>
      patchBoard((b) =>
        patchColumnFields(b, column.id, { title: column.title, rank: column.rank })
      )
    );
    socket.on("column.moved", (result: MoveColumnResult) =>
      patchBoard((b) => patchColumnFields(b, result.id, { rank: result.rank }))
    );
    socket.on("column.deleted", (p: ColumnDeletedPayload) =>
      patchBoard((b) => removeColumnFromBoard(b, p.id))
    );

    socket.connect();

    return () => {
      cancelled = true;
      socket.emit("leave", { boardId });
      socket.disconnect();
    };
  }, [boardId, qc]);

  return status;
}
