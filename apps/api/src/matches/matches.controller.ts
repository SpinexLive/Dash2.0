import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccessGuard } from '../common/guards/access.guard';
import { MatchesService } from './matches.service';

class CreateMatchDto {
  @IsOptional() @IsString() playedAt?: string;
  @IsOptional() @IsString() eventType?: string;
  @IsOptional() @IsString() eventName?: string;
  @IsOptional() @IsString() opponent?: string;
  @IsOptional() @IsString() url?: string;
}

@Controller('matches')
@UseGuards(JwtAuthGuard, AccessGuard)
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  list() {
    return this.matches.list();
  }

  @Post()
  create(@Body() dto: CreateMatchDto) {
    return this.matches.create(dto);
  }

  @Get(':id/stats')
  stats(@Param('id') id: string) {
    return this.matches.playerStats(BigInt(id));
  }

  @Post(':id/extract')
  extract(@Param('id') id: string) {
    return this.matches.extract(BigInt(id));
  }

  @Post(':id/share')
  share(@Param('id') id: string) {
    return this.matches.share(BigInt(id));
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.matches.remove(BigInt(id));
  }
}
