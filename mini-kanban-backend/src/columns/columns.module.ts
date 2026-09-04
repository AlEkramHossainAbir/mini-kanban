import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { TasksModule } from '../tasks/tasks.module';
import { ColumnsController } from './columns.controller';
import { ColumnsService } from './columns.service';

@Module({
  imports: [TasksModule, GatewayModule], // TasksModule: nested POST /columns/:columnId/tasks; GatewayModule: column.* broadcasts
  controllers: [ColumnsController],
  providers: [ColumnsService],
  // BoardsController injects this for the nested `POST /boards/:boardId/columns`
  // creation route.
  exports: [ColumnsService],
})
export class ColumnsModule {}
