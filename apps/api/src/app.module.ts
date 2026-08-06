import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { AccessControlModule } from './access-control/access-control.module';
import { MembersModule } from './members/members.module';
import { RecruitsModule } from './recruits/recruits.module';
import { SettingsModule } from './settings/settings.module';
import { MatchesModule } from './matches/matches.module';
import { RosterModule } from './roster/roster.module';
import { RaidHelperModule } from './raidhelper/raidhelper.module';
import { BriefingModule } from './briefing/briefing.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ConnectedServersModule } from './connected-servers/connected-servers.module';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret',
    }),
    PrismaModule,
    RedisModule,
    RealtimeModule,
    AuthModule,
    AccessControlModule,
    SettingsModule,
    MembersModule,
    RecruitsModule,
    MatchesModule,
    RosterModule,
    RaidHelperModule,
    BriefingModule,
    ConnectedServersModule,
  ],
})
export class AppModule {}
