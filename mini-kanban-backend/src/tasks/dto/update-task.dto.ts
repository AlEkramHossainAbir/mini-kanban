import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Title / description only (PLAN §3) — rank, columnId and version are the
// move endpoint's job, never this one's.
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}
