import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccessGuard } from '../common/guards/access.guard';
import { AdminOnly } from '../common/decorators/auth.decorators';
import { BriefingService } from './briefing.service';

class CheckAttendanceDto {
  @IsArray() @IsString({ each: true }) discordIds!: string[];
}

@Controller('briefing')
@UseGuards(JwtAuthGuard, AccessGuard)
export class BriefingController {
  constructor(private readonly briefing: BriefingService) {}

  @Get('voice/:channelId')
  voice(@Param('channelId') channelId: string) {
    return this.briefing.voiceMembers(channelId);
  }

  @Get('rosters')
  rosters() {
    return this.briefing.savedRosters();
  }

  @Get('rosters/:rosterId')
  roster(@Param('rosterId') rosterId: string) {
    return this.briefing.roster(rosterId);
  }

  @Post('check-voice')
  checkVoice(@Body() dto: CheckAttendanceDto) {
    return this.briefing.checkVoice(dto.discordIds);
  }

  @Post('check-game')
  checkGame(@Body() dto: CheckAttendanceDto) {
    return this.briefing.checkGame(dto.discordIds);
  }

  @Post('voice-channels')
  @AdminOnly()
  createVoiceChannels() {
    return this.briefing.createVoiceChannels();
  }

  @Get('server')
  server() {
    return this.briefing.serverPlayers();
  }
}
