import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BoardRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireRole } from '../common/decorators/require-role.decorator';
import {
  BoardAccessGuard,
  BoardScopedRequest,
} from '../common/guards/board-access.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PublicUser } from '../auth/public-user.type';
import { ColumnsService } from '../columns/columns.service';
import { CreateColumnDto } from '../columns/dto/create-column.dto';
import { BoardsService } from './boards.service';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateBoardDto } from './dto/create-board.dto';
import { ListBoardsQueryDto } from './dto/list-boards-query.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

// Every :boardId route below runs BoardAccessGuard → RolesGuard, in that
// order, after the global JwtAuthGuard (PLAN §4 / backend ROADMAP Phase 5).
// `create` and `list` are the only two routes with no board yet to resolve.
@Controller('boards')
export class BoardsController {
  constructor(
    private readonly boardsService: BoardsService,
    private readonly columnsService: ColumnsService,
  ) {}

  @Post()
  create(@CurrentUser() user: PublicUser, @Body() dto: CreateBoardDto) {
    return this.boardsService.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: PublicUser, @Query() query: ListBoardsQueryDto) {
    return this.boardsService.list(user.id, query);
  }

  @UseGuards(BoardAccessGuard, RolesGuard)
  @Get(':boardId')
  findOne(@Param('boardId') boardId: string, @Req() req: BoardScopedRequest) {
    return this.boardsService.findOne(boardId, req.boardRole!);
  }

  @UseGuards(BoardAccessGuard, RolesGuard)
  @RequireRole(BoardRole.EDITOR)
  @Patch(':boardId')
  update(@Param('boardId') boardId: string, @Body() dto: UpdateBoardDto) {
    return this.boardsService.update(boardId, dto);
  }

  @UseGuards(BoardAccessGuard, RolesGuard)
  @RequireRole(BoardRole.OWNER)
  @Delete(':boardId')
  @HttpCode(204)
  async remove(@Param('boardId') boardId: string): Promise<void> {
    await this.boardsService.remove(boardId);
  }

  @UseGuards(BoardAccessGuard, RolesGuard)
  @RequireRole(BoardRole.EDITOR)
  @Post(':boardId/columns')
  createColumn(
    @Param('boardId') boardId: string,
    @Body() dto: CreateColumnDto,
  ) {
    return this.columnsService.create(boardId, dto);
  }

  @UseGuards(BoardAccessGuard, RolesGuard)
  @Get(':boardId/members')
  listMembers(@Param('boardId') boardId: string) {
    return this.boardsService.listMembers(boardId);
  }

  @UseGuards(BoardAccessGuard, RolesGuard)
  @RequireRole(BoardRole.OWNER)
  @Post(':boardId/members')
  addMember(@Param('boardId') boardId: string, @Body() dto: AddMemberDto) {
    return this.boardsService.addMember(boardId, dto);
  }

  @UseGuards(BoardAccessGuard, RolesGuard)
  @RequireRole(BoardRole.OWNER)
  @Patch(':boardId/members/:userId')
  updateMember(
    @Param('boardId') boardId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.boardsService.updateMemberRole(boardId, userId, dto.role);
  }

  @UseGuards(BoardAccessGuard, RolesGuard)
  @RequireRole(BoardRole.OWNER)
  @Delete(':boardId/members/:userId')
  @HttpCode(204)
  async removeMember(
    @Param('boardId') boardId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.boardsService.removeMember(boardId, userId);
  }
}
