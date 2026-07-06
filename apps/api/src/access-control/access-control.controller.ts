import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import { prisma } from '@hll/db';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccessGuard } from '../common/guards/access.guard';
import { AdminOnly } from '../common/decorators/auth.decorators';
import { PermissionService } from './permission.service';

class AddRoleDto {
  @IsString() roleId!: string;
}
class AddUserDto {
  @IsString() discordId!: string;
}

@Controller('access')
@UseGuards(JwtAuthGuard, AccessGuard)
@AdminOnly()
export class AccessControlController {
  constructor(private readonly permissions: PermissionService) {}

  @Get('allowed')
  async list() {
    const [roles, users] = await Promise.all([
      prisma.accessAllowedRole.findMany(),
      prisma.accessAllowedUser.findMany(),
    ]);
    return { roles, users };
  }

  @Post('allowed/roles')
  async addRole(@Body() dto: AddRoleDto) {
    const role = await prisma.accessAllowedRole.upsert({
      where: { roleId: dto.roleId },
      create: { roleId: dto.roleId },
      update: {},
    });
    await this.permissions.bustAll();
    return role;
  }

  @Delete('allowed/roles/:roleId')
  async removeRole(@Param('roleId') roleId: string) {
    await prisma.accessAllowedRole.delete({ where: { roleId } });
    await this.permissions.bustAll();
    return { ok: true };
  }

  @Post('allowed/users')
  async addUser(@Body() dto: AddUserDto) {
    const user = await prisma.accessAllowedUser.upsert({
      where: { discordId: dto.discordId },
      create: { discordId: dto.discordId },
      update: {},
    });
    await this.permissions.bust(dto.discordId);
    return user;
  }

  @Delete('allowed/users/:discordId')
  async removeUser(@Param('discordId') discordId: string) {
    await prisma.accessAllowedUser.delete({ where: { discordId } });
    await this.permissions.bust(discordId);
    return { ok: true };
  }
}
