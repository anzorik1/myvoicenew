import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsString, IsUUID, Length } from 'class-validator';
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

  @Get(':id/result')
  async result(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.votes.publicVote(id, req.userId, await this.language(req.userId), true);
  }
}
