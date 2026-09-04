import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

// Imported by AuthModule (refresh-token reuse detection) and BoardsModule
// (share/unshare, role change, board deletion) — the only two places PLAN §5
// says produce auditable events.
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
