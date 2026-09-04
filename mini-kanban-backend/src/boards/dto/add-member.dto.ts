import { BoardRole } from '@prisma/client';
import { IsEmail, IsEnum } from 'class-validator';

export class AddMemberDto {
  @IsEmail()
  email: string;

  @IsEnum(BoardRole)
  role: BoardRole;
}
