import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { TaskVersionConflictException } from './task-version-conflict.exception';

/**
 * Applied only to the move route via `@UseFilters()` — every other error
 * in the app keeps going through the global `HttpExceptionFilter` (Phase
 * 3) unchanged. This one renders the exception's body exactly as-is,
 * because PLAN §3 specifies the move-conflict response as a fixed, minimal
 * shape with no wrapper — merging it into the generic filter's
 * `{statusCode,path,timestamp,message}` envelope would break that contract.
 */
@Catch(TaskVersionConflictException)
export class TaskVersionConflictFilter implements ExceptionFilter {
  catch(exception: TaskVersionConflictException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
