import { Module } from '@nestjs/common';
import { RaidHelperController } from './raidhelper.controller';
import { RaidHelperService } from './raidhelper.service';

@Module({
  controllers: [RaidHelperController],
  providers: [RaidHelperService],
  exports: [RaidHelperService],
})
export class RaidHelperModule {}
