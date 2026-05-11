import { Module } from '@nestjs/common';
import { SecurityEventsListener } from './security-event.listener';

@Module({
    providers: [SecurityEventsListener],
})
export class SecurityModule {}