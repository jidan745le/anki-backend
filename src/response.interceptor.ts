import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
  } from '@nestjs/common';
  import { map } from 'rxjs/operators';
  import { catchError, Observable, throwError,of } from 'rxjs';

  @Injectable()
  export class ResponseInterceptor implements NestInterceptor {
    intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Observable<any> {
      return next.handle().pipe(
        catchError(err => {
             console.log('err212312312', err)

            if(err.getStatus() === 200){
                return of({message:err.getResponse(),error:true})
            }
            return throwError(() => err)
          }),
        map((data) => {
          // 在这里对返回的数据进行包装
          if(data?.message && data?.error){
            return { 
                success: false,
                message: data.message,
                code:200,
                timestamp: new Date().toISOString(), // 添加时间戳
            }
          }
          return {
            success: true,
            data: data, // 原始数据
            code:200,
            timestamp: new Date().toISOString(), // 添加时间戳
          };
        }),
      );
    }
  }