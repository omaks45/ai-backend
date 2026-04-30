import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService } from '../../modules/rbac/rbac.service';

/**
 * A guard that checks if the authenticated user has the required permissions to access a route.
 */
export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: string[]) =>
    SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly rbac: RbacService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const required = this.reflector.getAllAndOverride<string[]>(
        PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
        );

        // No permissions required — allow through
        if (!required?.length) return true;

        const { user } = context.switchToHttp().getRequest();
        if (!user) throw new ForbiddenException('Not authenticated');

        /** Load the user's permissions from the RBAC service. */
        const userPermissions = await this.rbac.getUserPermissions(user.id);
        const missing = required.filter((p) => !userPermissions.has(p));

        if (missing.length > 0) {
        throw new ForbiddenException('Insufficient permissions');
        }

        return true;
    }
}