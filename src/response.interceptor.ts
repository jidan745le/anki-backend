import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { map } from 'rxjs/operators';
import { catchError, Observable, throwError, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const skipInterceptors = this.reflector.get<boolean>(
      'skipInterceptors',
      context.getHandler(),
    );

    if (skipInterceptors) {
      return next.handle();
    }

    const startTime = Date.now();
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;

    return next.handle().pipe(
      catchError((err) => {
        console.log(err, 'err');

        if (err.getStatus && err.getStatus() === 200) {
          return of({ message: err.getResponse(), error: true });
        }
        return throwError(() => err);
      }),
      map((data) => {
        if (data?.message && data?.error) {
          console.log('dataerr', data);
          return {
            success: false,
            message: data.message,
            code: 200,
            timestamp: new Date().toISOString(),
          };
        }
        return {
          success: true,
          data: data,
          code: 200,
          timestamp: new Date().toISOString(),
        };
      }),
      tap(() => {
        const processingTime = Date.now() - startTime;
        console.log('processingTime', processingTime);
        this.logger.log(`${method} ${url} - ${processingTime}ms`);
      }),
    );
  }
}
