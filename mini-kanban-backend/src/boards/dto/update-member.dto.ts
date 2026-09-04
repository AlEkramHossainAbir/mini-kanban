import { BoardRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateMemberDto {
  @IsEnum(BoardRole)
  role: BoardRole;
}
