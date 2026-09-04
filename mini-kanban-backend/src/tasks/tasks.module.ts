import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController],
  providers: [TasksService],
  // ColumnsController injects this for the nested
  // `POST /columns/:columnId/tasks` creation route.
  exports: [TasksService],
})
export class TasksModule {}
