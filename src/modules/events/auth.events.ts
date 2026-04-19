import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AuthEventsListener {
    private readonly logger = new Logger(AuthEventsListener.name);

    constructor(private readonly prisma: PrismaService) {}

    @OnEvent('auth.user.registered')
    async onUserRegistered(user: { id: string; email: string; tier: string }) {
        try {
        await Promise.all([
            this.prisma.usageLog.create({
            data: { userId: user.id, action: 'signup', tokens: 0, costUsd: 0 },
            }),
            this.prisma.conversation.create({
            data: { userId: user.id, title: 'Welcome to DocuChat' },
            }),
        ]);
        } catch (err) {
        this.logger.error('Failed to handle user.registered event', err);
        }
    }

    @OnEvent('auth.user.logged_in')
    async onUserLoggedIn(data: { userId: string; deviceInfo?: string }) {
        try {
        await this.prisma.usageLog.create({
            data: {
            userId: data.userId,
            action: 'login',
            tokens: 0,
            costUsd: 0,
            metadata: { deviceInfo: data.deviceInfo, loginAt: new Date() },
            },
        });
        } catch (err) {
        this.logger.error('Failed to handle user.logged_in event', err);
        }
    }

    @OnEvent('auth.login.failed')
    onLoginFailed(data: { email: string; deviceInfo?: string }) {
        this.logger.warn(`Failed login attempt for ${data.email}`);
    }
}