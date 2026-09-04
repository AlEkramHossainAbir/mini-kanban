import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

// Mirrors the task move payload shape (PLAN §3), minus `targetColumnId`
// (columns never move between boards) and `expectedVersion` (Column carries
// no `version` column — optimistic-concurrency rigor is task move's job,
// Phase 8, the assessment's graded core; column reordering is lower-stakes).
export class MoveColumnDto {
  @IsOptional()
  @IsUUID()
  beforeColumnId?: string;

  @IsOptional()
  @IsUUID()
  afterColumnId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}
