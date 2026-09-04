import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { BoardRole } from '@prisma/client';
import { RequireRole } from '../common/decorators/require-role.decorator';
import {
  BoardAccessGuard,
  BoardScopedRequest,
} from '../common/guards/board-access.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { MoveTaskDto } from './dto/move-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskVersionConflictFilter } from './task-version-conflict.filter';
import { TasksService } from './tasks.service';

// All routes here are EDITOR+ (PLAN §3), set once at class level. Task
// *creation* lives on ColumnsController (`POST /columns/:columnId/tasks`)
// since it's nested under the column resource; these are the task's own
// top-level routes.
@Controller('tasks')
@UseGuards(BoardAccessGuard, RolesGuard)
@RequireRole(BoardRole.EDITOR)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Patch(':taskId')
  update(@Param('taskId') taskId: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(taskId, dto);
  }

  @Delete(':taskId')
  @HttpCode(204)
  async remove(@Param('taskId') taskId: string): Promise<void> {
    await this.tasksService.remove(taskId);
  }

  // The graded core (backend ROADMAP Phase 8). TaskVersionConflictFilter is
  // scoped to just this route — see its own docblock for why.
  @UseFilters(TaskVersionConflictFilter)
  @Patch(':taskId/move')
  move(
    @Param('taskId') taskId: string,
    @Req() req: BoardScopedRequest,
    @Body() dto: MoveTaskDto,
  ) {
    // req.boardId was already resolved (and authorized) by BoardAccessGuard
    // via this same :taskId.
    return this.tasksService.move(req.boardId!, taskId, dto);
  }
}
