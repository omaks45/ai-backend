
// WHY A CUSTOM DECORATOR?
// The JWT guard attaches the validated user to req.user. Without this decorator
// every controller would write `const user = req['user']` or cast the request
// type manually. The decorator hides that boilerplate and makes the intent clear
// at the call site: @CurrentUser() user: AuthUser.
//
// createParamDecorator is NestJS's way to build parameter-level decorators that
// extract a value from the execution context. It works for HTTP, WebSockets,
// and gRPC contexts with no changes.

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
    id:    string;
    email: string;
    tier:  string;
}

export const CurrentUser = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): AuthUser => {
        const request = ctx.switchToHttp().getRequest();
        return request.user as AuthUser;
    },
);
