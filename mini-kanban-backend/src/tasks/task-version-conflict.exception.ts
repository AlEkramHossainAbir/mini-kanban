import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The move endpoint's `409` response has a fixed, minimal shape (PLAN §3):
 * `{ error: 'VERSION_CONFLICT', currentTask }` — the frontend reconciles
 * from `currentTask` without a full board refetch. Paired with
 * `TaskVersionConflictFilter`, which renders exactly this body with none
 * of the app-wide exception filter's statusCode/path/timestamp wrapper.
 */
export class TaskVersionConflictException extends HttpException {
  constructor(currentTask: unknown) {
    super({ error: 'VERSION_CONFLICT', currentTask }, HttpStatus.CONFLICT);
  }
}
