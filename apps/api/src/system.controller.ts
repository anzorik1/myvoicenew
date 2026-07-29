import { Controller, Get } from '@nestjs/common';
import { RULES } from '@myvoice/config';
import { PrismaService } from './prisma.service';

@Controller('system')
export class SystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('features')
  async features() {
    const [flags, users] = await Promise.all([
      this.prisma.featureFlag.findMany({ where: { public: true } }),
      this.prisma.user.count({ where: { registrationCompletedAt: { not: null } } }),
    ]);
    const active = (key: string, fallback: number) => {
      const flag = flags.find((item) => item.key === key);
      return Boolean(flag?.enabled && users >= (flag.usersThreshold ?? fallback));
    };
    return {
      suggestions: active('SUGGESTIONS', RULES.SUGGESTIONS_USERS_THRESHOLD),
      earlyVoteBonus: active('EARLY_VOTE_BONUS', RULES.EARLY_REWARD_USERS_THRESHOLD),
      predictionRewards: active(
        'PREDICTION_REWARDS',
        RULES.PREDICTION_REWARDS_USERS_THRESHOLD,
      ),
      tonWallet: false,
    };
  }

  @Get('public-settings')
  async settings() {
    const rows = await this.prisma.systemSetting.findMany({ where: { public: true } });
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }
}
