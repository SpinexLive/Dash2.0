import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccessGuard } from '../common/guards/access.guard';
import { RaidHelperService } from './raidhelper.service';

@Controller('raidhelper')
@UseGuards(JwtAuthGuard, AccessGuard)
export class RaidHelperController {
  constructor(private readonly raidhelper: RaidHelperService) {}

  /** Events starting within the past 2 hours or any time in the future. */
  @Get('events')
  listEvents() {
    return this.raidhelper.listEvents();
  }

  /** A single event with its sign-ups enriched with dashboard stats. */
  @Get('events/:id')
  async getEvent(@Param('id') id: string) {
    const event = await this.raidhelper.getEventWithSignups(id);
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }
}
