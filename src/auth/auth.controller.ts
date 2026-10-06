import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminGuard, AdminId, CustomerGuard, CustomerId } from './auth.guards.js';
import { AdminLoginDto, LoginDto, OtpRequestDto, OtpVerifyDto, RegisterDto } from './auth.dto.js';

// Sign-in endpoints are rate limited harder than the rest of the API.
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register') @Throttle(STRICT)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login') @HttpCode(200) @Throttle(STRICT)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /** Sends a one-time sign-in code by email or SMS. */
  @Post('otp') @HttpCode(202) @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestOtp(@Body() dto: OtpRequestDto) {
    return this.auth.requestOtp(dto);
  }

  @Post('verify') @HttpCode(200) @Throttle(STRICT)
  verify(@Body() dto: OtpVerifyDto) {
    return this.auth.verifyOtp(dto);
  }

  @Get('me') @UseGuards(CustomerGuard) @ApiBearerAuth()
  me(@CustomerId() id: string) {
    return this.auth.me(id);
  }
}

@ApiTags('admin')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login') @HttpCode(200) @Throttle(STRICT)
  login(@Body() dto: AdminLoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me') @UseGuards(AdminGuard) @ApiBearerAuth()
  me(@AdminId() id: string) {
    return this.auth.me(id);
  }
}
