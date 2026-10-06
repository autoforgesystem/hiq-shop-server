import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminAuthController, AuthController } from './auth.controller.js';
import { AdminGuard, CustomerGuard, OptionalCustomerGuard, TokenReader } from './auth.guards.js';
import { AuthService } from './auth.service.js';

/** Global so every feature module can use the guards without importing this module. */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({ secret: config.get('JWT_SECRET', { infer: true }), signOptions: { issuer: 'hiq-shop' }, verifyOptions: { issuer: 'hiq-shop' } }),
    }),
  ],
  controllers: [AuthController, AdminAuthController],
  providers: [AuthService, AdminAuthService, TokenReader, CustomerGuard, OptionalCustomerGuard, AdminGuard],
  exports: [JwtModule, AuthService, TokenReader, CustomerGuard, OptionalCustomerGuard, AdminGuard],
})
export class AuthModule {}
