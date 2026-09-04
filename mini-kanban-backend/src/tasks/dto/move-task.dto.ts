import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

// PLAN §3's move payload, verbatim. `targetColumnId` equal to the task's
// current column is a same-column reorder; different is a cross-column
// move — same endpoint, same shape, no special-casing needed by the client.
export class MoveTaskDto {
  @IsUUID()
  targetColumnId: string;

  @IsOptional()
  @IsUUID()
  beforeTaskId?: string;

  @IsOptional()
  @IsUUID()
  afterTaskId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;

  // Optimistic-concurrency token (PLAN §3) — required, not optional: the
  // move endpoint is unusable without it.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion: number;
}
