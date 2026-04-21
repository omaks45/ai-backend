import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [RbacModule],
  controllers: [AdminController],
})
export class AdminModule {}