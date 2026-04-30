// WHY A GLOBAL EXCEPTION FILTER?
// Without this, NestJS returns raw exception objects whose shape varies by
// exception type. A global filter normalises every error into the same envelope
// { success, statusCode, error, path, timestamp } so the frontend only needs
// to handle one shape.
//
// OPERATIONAL vs PROGRAMMING ERRORS:
// HttpExceptions (BadRequest, NotFound, Forbidden…) are OPERATIONAL — they are
// expected conditions encoded by the application. We return their message.
// Everything else is a PROGRAMMING ERROR (bug). We return a generic message
// and log the full stack trace server-side so sensitive internals never leak
// to the client.

import {
    ExceptionFilter, Catch, ArgumentsHost,
    HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx    = host.switchToHttp();
        const req    = ctx.getRequest<Request>();
        const res    = ctx.getResponse<Response>();
        const isHttp = exception instanceof HttpException;

        const status = isHttp
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

        // Operational errors: safe to forward the message to the client.
        // Programming errors: log full stack, return generic message.
        if (!isHttp) {
        this.logger.error(
            'Unhandled exception',
            exception instanceof Error ? exception.stack : String(exception),
        );
        }

        const errorBody = isHttp
        ? (exception.getResponse() as object)
        : { message: 'An unexpected error occurred' };

        res.status(status).json({
        success:    false,
        statusCode: status,
        error:      errorBody,
        path:       req.url,
        timestamp:  new Date().toISOString(),
        });
    }
}
