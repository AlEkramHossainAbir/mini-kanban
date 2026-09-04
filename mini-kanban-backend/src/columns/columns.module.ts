import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { ColumnsController } from './columns.controller';
import { ColumnsService } from './columns.service';

@Module({
  imports: [TasksModule], // for the nested POST /columns/:columnId/tasks route
  controllers: [ColumnsController],
  providers: [ColumnsService],
  // BoardsController injects this for the nested `POST /boards/:boardId/columns`
  // creation route.
  exports: [ColumnsService],
})
export class ColumnsModule {}
