import { BadRequestException } from '@nestjs/common';

export interface BoardsCursor {
  createdAt: Date;
  id: string;
}

/**
 * The `GET /boards` cursor (PLAN §2) — opaque to the client, encodes the
 * composite `(createdAt, id)` keyset position of the last item on the
 * previous page.
 */
export function encodeCursor(cursor: BoardsCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString('base64url');
}

export function decodeCursor(raw: string): BoardsCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed?.id !== 'string' ||
      typeof parsed?.createdAt !== 'string'
    ) {
      throw new Error('malformed cursor payload');
    }
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('malformed cursor timestamp');
    }
    return { createdAt, id: parsed.id };
  } catch {
    // Never leak the parse error's internals — a tampered/garbage cursor is
    // just a 400, not a stack trace.
    throw new BadRequestException('Invalid cursor');
  }
}
