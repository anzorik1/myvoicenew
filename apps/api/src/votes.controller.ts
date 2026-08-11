import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { VoteReportReason } from '@prisma/client';
import { AuthRequest, UserAuthGuard } from './common';
import { PrismaService } from './prisma.service';
import { VotesService } from './votes.service';

class CastVoteDto {
  @IsUUID()
  optionId!: string;
  @IsString()
  @Length(8, 80)
  idempotencyKey!: string;
}

class VoteReportDto {
  @IsIn(['MISLEADING', 'OFFENSIVE', 'BIASED', 'OTHER'])
  reason!: VoteReportReason;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  details?: string;
}

@Controller('votes')
@UseGuards(UserAuthGuard)
export class VotesController {
  constructor(
    private readonly votes: VotesService,
    private readonly prisma: PrismaService,
  ) {}

  private async language(userId: string) {
    return (await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })).languageCode;
  }

  @Get('current')
  async current(@Req() req: AuthRequest) {
    return this.votes.current(req.userId, await this.language(req.userId));
  }

  @Get('history')
  async history(
    @Req() req: AuthRequest,
    @Query('filter') filter: 'all' | 'participated' | 'missed' = 'all',
    @Query('cursor') cursor?: string,
  ) {
    if (!['all', 'participated', 'missed'].includes(filter)) filter = 'all';
    return this.votes.history(req.userId, await this.language(req.userId), filter, cursor);
  }

  @Get(':id')
  async one(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.votes.publicVote(id, req.userId, await this.language(req.userId));
  }

  @Post(':id/cast')
  async cast(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: CastVoteDto) {
    return this.votes.cast(req.userId, id, dto.optionId, dto.idempotencyKey);
  }

  @Post(':id/reports')
  async report(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: VoteReportDto) {
    return this.votes.report(req.userId, id, dto.reason, dto.details);
  }

  @Get(':id/result')
  async result(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.votes.publicVote(id, req.userId, await this.language(req.userId), true);
  }
}
