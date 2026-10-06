import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Customer } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { digits, normalizeEmail } from '../common/util.js';
import type { Env } from '../config/env.js';
import type { LoginDto, OtpRequestDto, OtpVerifyDto, RegisterDto } from './auth.dto.js';

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_MS = 60_000;
// Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

/** What the API returns for a customer. Never includes the password hash. */
export const publicCustomer = (c: Customer) => ({
  id: c.id, firstName: c.firstName, lastName: c.lastName, name: `${c.firstName} ${c.lastName}`,
  email: c.email, phone: c.phone, marketingOptIn: c.marketingOptIn,
});

/** 0917…, 63917… and +63 917… all become 0917… so they match. */
export const phoneKey = (phone: string) => {
  const d = digits(phone);
  return d.startsWith('63') && d.length === 12 ? `0${d.slice(2)}` : d;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly notify: NotificationsService,
  ) {}

  private session(c: Customer, remember = true) {
    const expiresIn = this.config.get(remember ? 'CUSTOMER_TOKEN_TTL_REMEMBER' : 'CUSTOMER_TOKEN_TTL', { infer: true });
    return { token: this.jwt.sign({ sub: c.id, kind: 'customer' }, { expiresIn: expiresIn as never }), customer: publicCustomer(c) };
  }

  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);
    if (await this.db.customer.findUnique({ where: { email } })) throw new ConflictException('An account with this email already exists. Sign in instead.');
    const c = await this.db.customer.create({
      data: {
        firstName: dto.firstName, lastName: dto.lastName, email, phone: dto.phone.trim(),
        passwordHash: await bcrypt.hash(dto.password, 12), marketingOptIn: dto.marketingOptIn ?? false,
      },
    });
    return this.session(c);
  }

  async login(dto: LoginDto) {
    const c = await this.db.customer.findUnique({ where: { email: normalizeEmail(dto.email) } });
    const ok = await bcrypt.compare(dto.password, c?.passwordHash ?? DUMMY_HASH);
    if (!c || !c.passwordHash || !ok) throw new UnauthorizedException("That email and password don't match an account. Please try again.");
    return this.session(c, dto.remember ?? true);
  }

  private async findByDestination(destination: string) {
    if (destination.includes('@')) return this.db.customer.findUnique({ where: { email: normalizeEmail(destination) } });
    const key = phoneKey(destination);
    const rows = await this.db.$queryRaw<{ id: string }[]>`SELECT id FROM customers WHERE regexp_replace(phone, '\\D', '', 'g') IN (${key}, ${'63' + key.slice(1)}) LIMIT 1`;
    return rows[0] ? this.db.customer.findUnique({ where: { id: rows[0].id } }) : null;
  }

  private destinationKey = (d: string) => (d.includes('@') ? normalizeEmail(d) : phoneKey(d));
  private hashCode = (dest: string, code: string) => createHmac('sha256', this.config.get('OTP_SECRET', { infer: true })).update(`${dest}:${code}`).digest('hex');

  /** Always answers the same way, so it can't be used to find out who has an account. */
  async requestOtp(dto: OtpRequestDto) {
    const dest = this.destinationKey(dto.destination);
    const c = await this.findByDestination(dto.destination);
    const recent = await this.db.authOtp.findFirst({ where: { destination: dest, createdAt: { gt: new Date(Date.now() - OTP_RESEND_MS) } } });
    if (c && !recent) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const channel = dest.includes('@') ? 'email' : 'sms';
      await this.db.authOtp.create({ data: { customerId: c.id, channel, destination: dest, codeHash: this.hashCode(dest, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) } });
      const text = `Your HIQ sign-in code is ${code}. It expires in 10 minutes.`;
      if (channel === 'email') await this.notify.email(c.email, 'Your HIQ sign-in code', text);
      else await this.notify.sms(c.phone, text);
    }
    return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  async verifyOtp(dto: OtpVerifyDto) {
    const dest = this.destinationKey(dto.destination);
    const otp = await this.db.authOtp.findFirst({ where: { destination: dest, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, include: { customer: true } });
    const fail = () => new UnauthorizedException('That code is wrong or has expired. Request a new one.');
    if (!otp?.customer || otp.attempts >= OTP_MAX_ATTEMPTS) throw fail();
    const a = Buffer.from(otp.codeHash, 'hex'), b = Buffer.from(this.hashCode(dest, dto.code), 'hex');
    if (!timingSafeEqual(a, b)) {
      await this.db.authOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw fail();
    }
    await this.db.authOtp.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
    const c = dest.includes('@') && !otp.customer.emailVerifiedAt
      ? await this.db.customer.update({ where: { id: otp.customer.id }, data: { emailVerifiedAt: new Date() } })
      : otp.customer;
    return this.session(c);
  }

  async me(id: string) {
    const c = await this.db.customer.findUnique({ where: { id } });
    if (!c) throw new UnauthorizedException('Please sign in.');
    return publicCustomer(c);
  }
}
