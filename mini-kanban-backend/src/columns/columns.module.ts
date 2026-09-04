import { Module } from '@nestjs/common';
import { ColumnsController } from './columns.controller';
import { ColumnsService } from './columns.service';

@Module({
  controllers: [ColumnsController],
  providers: [ColumnsService],
  // BoardsController injects this for the nested `POST /boards/:boardId/columns`
  // creation route.
  exports: [ColumnsService],
})
export class ColumnsModule {}
