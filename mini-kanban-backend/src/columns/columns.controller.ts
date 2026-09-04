import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BoardRole } from '@prisma/client';
import { RequireRole } from '../common/decorators/require-role.decorator';
import {
  BoardAccessGuard,
  BoardScopedRequest,
} from '../common/guards/board-access.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ColumnsService } from './columns.service';
import { MoveColumnDto } from './dto/move-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';

// All three routes here are EDITOR+ (PLAN §3) — set once at class level
// rather than repeated per method. Column *creation* lives on
// BoardsController (`POST /boards/:boardId/columns`) since it's nested
// under the board resource; these are the column's own top-level routes.
@Controller('columns')
@UseGuards(BoardAccessGuard, RolesGuard)
@RequireRole(BoardRole.EDITOR)
export class ColumnsController {
  constructor(private readonly columnsService: ColumnsService) {}

  @Patch(':columnId')
  update(@Param('columnId') columnId: string, @Body() dto: UpdateColumnDto) {
    return this.columnsService.update(columnId, dto);
  }

  @Delete(':columnId')
  @HttpCode(204)
  async remove(@Param('columnId') columnId: string): Promise<void> {
    await this.columnsService.remove(columnId);
  }

  @Patch(':columnId/move')
  move(
    @Param('columnId') columnId: string,
    @Req() req: BoardScopedRequest,
    @Body() dto: MoveColumnDto,
  ) {
    // req.boardId was already resolved (and authorized) by BoardAccessGuard
    // via this same :columnId — reusing it avoids a second lookup.
    return this.columnsService.move(req.boardId!, columnId, dto);
  }
}
