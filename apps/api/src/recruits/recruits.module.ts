import { Module } from '@nestjs/common';
import { RecruitsController } from './recruits.controller';
import { RecruitsService } from './recruits.service';

@Module({
  controllers: [RecruitsController],
  providers: [RecruitsService],
})
export class RecruitsModule {}
