import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController, AdminController } from './admin.controller';
import { AdminLoginThrottleService, TurnstileService } from './admin-auth-security.service';
import { AdminAdsController, AdsController, AdsService } from './ads.controller';
import { AuthController } from './telegram-auth';
import { AdminAuthGuard, RedisRateLimitMiddleware, UserAuthGuard } from './common';
import { JobsService } from './jobs.service';
import { MeController } from './me.controller';
import { PrismaService } from './prisma.service';
import { SuggestionsController } from './suggestions.controller';
import { SystemController } from './system.controller';
import { TapController, TapService } from './tap.controller';
import { VotesController } from './votes.controller';
import { VotesService } from './votes.service';
import { VoxService } from './vox.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [
    AuthController,
    MeController,
    VotesController,
    SuggestionsController,
    SystemController,
    AdminAuthController,
    AdminController,
    AdsController,
    AdminAdsController,
    TapController,
  ],
  providers: [
    PrismaService,
    VoxService,
    VotesService,
    JobsService,
    UserAuthGuard,
    AdminAuthGuard,
    AdminLoginThrottleService,
    TurnstileService,
    AdsService,
    TapService,
  ],
  exports: [PrismaService, VotesService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RedisRateLimitMiddleware).forRoutes('*');
  }
}
