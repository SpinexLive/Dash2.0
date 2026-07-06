import { Global, Module } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { AccessControlController } from './access-control.controller';

@Global()
@Module({
  controllers: [AccessControlController],
  providers: [PermissionService],
  exports: [PermissionService],
})
export class AccessControlModule {}
