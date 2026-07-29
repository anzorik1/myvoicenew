import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const payload =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: 500, message: 'Internal server error' };
    if (status >= 500) {
      this.logger.error(`${request.method} ${request.originalUrl}`, exception);
    } else {
      this.logger.warn(`${request.method} ${request.originalUrl} -> ${status}`);
    }
    response.status(status).json(
      typeof payload === 'string'
        ? { statusCode: status, message: payload }
        : { ...payload, path: request.originalUrl, timestamp: new Date().toISOString() },
    );
  }
}

@Injectable()
export class WriteAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('ImportantAction');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const started = Date.now();
    return next.handle().pipe(
      tap(() => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
          this.logger.log(
            `${request.method} ${request.originalUrl} completed in ${Date.now() - started}ms`,
          );
        }
      }),
    );
  }
}
