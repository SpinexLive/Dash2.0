import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@hll/shared';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccessGuard } from '../common/guards/access.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RecruitsService } from './recruits.service';

@Controller('recruits')
@UseGuards(JwtAuthGuard, AccessGuard)
export class RecruitsController {
  constructor(private readonly recruits: RecruitsService) {}

  @Get()
  list(@Query('status') status?: 'pending' | 'accepted' | 'rejected') {
    return this.recruits.list(status);
  }

  @Post('refresh')
  refresh() {
    return this.recruits.refresh();
  }

  @Post(':id/process')
  process(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.recruits.process(BigInt(id), user.discordId);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.recruits.reject(BigInt(id), user.discordId);
  }
}
