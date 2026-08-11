import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController, AdminController } from './admin.controller';
import { AdminLoginThrottleService, TurnstileService } from './admin-auth-security.service';
import { AdminAdsController, AdsController, AdsService } from './ads.controller';
import { AuthController } from './telegram-auth';
import { AdminAuthGuard, RedisRateLimitMiddleware, UserAuthGuard } from './common';
import { JobsService } from './jobs.service';
import { LeaderboardController } from './leaderboard.controller';
import { MeController } from './me.controller';
import { AdminMediaController, MediaController } from './media.controller';
import { NotificationService } from './notification.service';
import { PrismaService } from './prisma.service';
import { SuggestionsController } from './suggestions.controller';
import { SystemController } from './system.controller';
import { VotesController } from './votes.controller';
import { VotesService } from './votes.service';
import { VoxService } from './vox.service';
import { ShareActionsController, ShareController } from './share.controller';

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    AuthController,
    MeController,
    MediaController,
    AdminMediaController,
    LeaderboardController,
    VotesController,
    ShareActionsController,
    ShareController,
    SuggestionsController,
    SystemController,
    AdminAuthController,
    AdminController,
    AdsController,
    AdminAdsController,
  ],
  providers: [
    PrismaService,
    VoxService,
    VotesService,
    JobsService,
    NotificationService,
    UserAuthGuard,
    AdminAuthGuard,
    AdminLoginThrottleService,
    TurnstileService,
    AdsService,
  ],
  exports: [PrismaService, VotesService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RedisRateLimitMiddleware).forRoutes('*');
  }
}
