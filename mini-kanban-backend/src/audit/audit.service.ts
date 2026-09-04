import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditAction, AuditEntity } from './audit.actions';

export interface AuditEvent {
  /** The actor who performed the action; null for system-detected events. */
  userId: string | null;
  /** Denormalized on purpose (PLAN §2) — null for non-board security events. */
  boardId: string | null;
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Best-effort, fire-after-commit record of an access-control event.
   *
   * Never throws: the caller's mutation has already succeeded by the time
   * this runs, so turning a failed audit *insert* into a 500 would tell the
   * client its share/removal didn't happen when it demonstrably did. A lost
   * row is logged loudly instead. (PLAN §7.5 moves this onto a BullMQ queue
   * once it's worth taking off the request path at all.)
   */
  async log(event: AuditEvent): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: event.userId,
          boardId: event.boardId,
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId,
          metadata: event.metadata,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log ${event.action} for ${event.entityType}:${event.entityId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
