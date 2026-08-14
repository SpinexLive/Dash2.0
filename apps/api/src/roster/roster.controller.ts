import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccessGuard } from '../common/guards/access.guard';
import { RosterService } from './roster.service';

class SaveRosterBodyDto {
  @IsObject() data!: Record<string, unknown>;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() eventTitle?: string;
  @IsOptional() eventStartTime?: string | number | null;
  @IsOptional() @IsString() channelId?: string | null;
}
class RespondDto {
  @IsIn(['accepted', 'declined']) response!: 'accepted' | 'declined';
}
class PostRosterDto {
  @IsOptional() @IsBoolean() assignSquadLeaderRole?: boolean;
}

@Controller('roster')
@UseGuards(JwtAuthGuard, AccessGuard)
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  /** Event ids that already have a saved roster (for list badges). */
  @Get('events-with-rosters')
  eventIdsWithRosters() {
    return this.roster.eventIdsWithRosters();
  }

  /** The saved roster for an event (or null). */
  @Get('event/:eventId')
  getByEvent(@Param('eventId') eventId: string) {
    return this.roster.getByEvent(eventId);
  }

  /** Create or update the roster layout for an event. */
  @Put('event/:eventId')
  save(@Param('eventId') eventId: string, @Body() dto: SaveRosterBodyDto) {
    return this.roster.save(eventId, dto);
  }

  /** Post the roster embed to Discord. */
  @Post('event/:eventId/post')
  post(@Param('eventId') eventId: string, @Body() dto: PostRosterDto) {
    return this.roster.post(eventId, dto.assignSquadLeaderRole === true);
  }

  /** Assign the configured Squad Leader role to leadership positions in this saved roster. */
  @Post('event/:eventId/assign-squad-leader-role')
  assignSquadLeaderRole(@Param('eventId') eventId: string) {
    return this.roster.assignSquadLeaderRole(eventId);
  }

  /** Update the already-posted Discord roster embed. */
  @Post('event/:eventId/update-discord')
  updateDiscord(@Param('eventId') eventId: string) {
    return this.roster.updateDiscord(eventId);
  }

  /** Ping players who have not yet confirmed. */
  @Post('event/:eventId/remind-pending')
  remindPending(@Param('eventId') eventId: string) {
    return this.roster.remindPending(eventId);
  }

  /** Remove the configured temporary squad-leader role from every guild member. */
  @Post('cleanup-squad-leader-role')
  cleanupSquadLeaderRole() {
    return this.roster.cleanupSquadLeaderRole();
  }

  /** Record a player's accept/decline from the dashboard. */
  @Post('slots/:slotId/respond')
  respond(@Param('slotId') slotId: string, @Body() dto: RespondDto) {
    return this.roster.respond(BigInt(slotId), dto.response);
  }
}
