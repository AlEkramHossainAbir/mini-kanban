import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ColumnsModule } from '../columns/columns.module';
import { GatewayModule } from '../gateway/gateway.module';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';

@Module({
  imports: [
    ColumnsModule, // for the nested POST /boards/:boardId/columns route
    AuditModule, // share/unshare, role change, board deletion (PLAN §5)
    GatewayModule, // BoardsService broadcasts member.roleChanged/removed after commit
  ],
  controllers: [BoardsController],
  providers: [BoardsService],
})
export class BoardsModule {}
