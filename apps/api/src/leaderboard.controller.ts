import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthRequest, UserAuthGuard } from './common';
import { PrismaService } from './prisma.service';

type WeeklyRankRow = {
  rank: number;
  user_id: string;
  first_name: string;
  username: string | null;
  participations: number;
  activity_rate: unknown;
};

@Controller('leaderboard')
@UseGuards(UserAuthGuard)
export class LeaderboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('weekly')
  async weekly(@Req() req: AuthRequest) {
    const periodStart = new Date(Date.now() - 7 * 86_400_000);
    const rows = await this.prisma.$queryRaw<WeeklyRankRow[]>`
      WITH weekly AS (
        SELECT uv.user_id, COUNT(*)::int AS participations
        FROM user_votes uv
        INNER JOIN votes v ON v.id = uv.vote_id
        WHERE v.status = 'COMPLETED'
          AND v.completed_at >= ${periodStart}
          AND v.deleted_at IS NULL
        GROUP BY uv.user_id
      ), ranked AS (
        SELECT
          DENSE_RANK() OVER (ORDER BY w.participations DESC, u.activity_rate DESC)::int AS rank,
          u.id AS user_id,
          u.first_name,
          u.username,
          w.participations,
          u.activity_rate
        FROM weekly w
        INNER JOIN users u ON u.id = w.user_id
        WHERE u.status = 'ACTIVE'
      )
      SELECT * FROM ranked
      WHERE rank <= 50 OR user_id = ${req.userId}::uuid
      ORDER BY rank ASC, first_name ASC
    `;
    const publicRow = (row: WeeklyRankRow) => ({
      rank: Number(row.rank),
      firstName: row.first_name,
      username: row.username,
      participations: Number(row.participations),
      activityRate: Math.round(Number(row.activity_rate)),
      isMe: row.user_id === req.userId,
    });
    return {
      periodStart,
      periodEnd: new Date(),
      items: rows.filter((row) => Number(row.rank) <= 50).map(publicRow),
      me: rows.find((row) => row.user_id === req.userId)
        ? publicRow(rows.find((row) => row.user_id === req.userId)!)
        : { rank: null, participations: 0, isMe: true },
    };
  }
}
