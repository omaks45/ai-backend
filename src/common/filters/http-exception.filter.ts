import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        const isHttpException = exception instanceof HttpException;
        const status = isHttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

        const message = isHttpException
        ? (exception.getResponse() as any)
        : 'An unexpected error occurred';

        if (!isHttpException) {
        this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
        }

        response.status(status).json({
        success: false,
        statusCode: status,
        error: typeof message === 'object' ? message : { message },
        path: request.url,
        timestamp: new Date().toISOString(),
        });
    }
}