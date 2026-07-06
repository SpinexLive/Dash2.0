import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { PgListenerService } from './pg-listener.service';

@Module({
  providers: [RealtimeGateway, PgListenerService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
