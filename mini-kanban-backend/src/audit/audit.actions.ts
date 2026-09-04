/**
 * The closed set of auditable actions (PLAN §5). Deliberately short: only
 * access-control-sensitive events are recorded here. Routine task/column
 * mutations — including moves — are *not* audited; PLAN §5 calls them noise
 * that would bury the events a reviewer actually cares about.
 */
export const AuditAction = {
  BOARD_SHARE: 'BOARD_SHARE',
  BOARD_UNSHARE: 'BOARD_UNSHARE',
  ROLE_CHANGE: 'ROLE_CHANGE',
  BOARD_DELETE: 'BOARD_DELETE',
  REFRESH_TOKEN_REUSE: 'REFRESH_TOKEN_REUSE',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditEntity = {
  BOARD: 'Board',
  BOARD_MEMBER: 'BoardMember',
  REFRESH_TOKEN: 'RefreshToken',
} as const;

export type AuditEntity = (typeof AuditEntity)[keyof typeof AuditEntity];
