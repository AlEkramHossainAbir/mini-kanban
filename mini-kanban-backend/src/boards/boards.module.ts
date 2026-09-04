import { Module } from '@nestjs/common';
import { ColumnsModule } from '../columns/columns.module';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';

@Module({
  imports: [ColumnsModule], // for the nested POST /boards/:boardId/columns route
  controllers: [BoardsController],
  providers: [BoardsService],
})
export class BoardsModule {}
