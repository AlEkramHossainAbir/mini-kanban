import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [GatewayModule], // TasksService broadcasts task.* after commit
  controllers: [TasksController],
  providers: [TasksService],
  // ColumnsController injects this for the nested
  // `POST /columns/:columnId/tasks` creation route.
  exports: [TasksService],
})
export class TasksModule {}
