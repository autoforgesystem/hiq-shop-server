import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';
import { NotificationsModule } from './notifications/notifications.service.js';
import { AuditModule } from './audit/audit.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { ServiceModule } from './service/service.module.js';
import { MeModule } from './me/me.module.js';
import { LeadsModule } from './leads/leads.module.js';
import { AdminModule } from './admin/admin.controller.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // 120 requests a minute per IP by default; sign-in and form routes set stricter limits.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }], skipIf: () => process.env.THROTTLE_DISABLED === 'true' }),
    ScheduleModule.forRoot(),
    PrismaModule,
    NotificationsModule,
    AuditModule,
    AuthModule,
    CatalogModule,
    OrdersModule,
    ServiceModule,
    MeModule,
    LeadsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
