import { Module } from '@nestjs/common';
import { ConnectedServersController } from './connected-servers.controller';

@Module({
  controllers: [ConnectedServersController],
})
export class ConnectedServersModule {}
