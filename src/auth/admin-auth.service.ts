import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import type { AdminUser } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeEmail } from '../common/util.js';
import type { Env } from '../config/env.js';

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
export const publicAdmin = (a: AdminUser) => ({ id: a.id, email: a.email, name: a.name, role: a.role, lastLoginAt: a.lastLoginAt });

@Injectable()
export class AdminAuthService {
  constructor(private readonly db: PrismaService, private readonly jwt: JwtService, private readonly config: ConfigService<Env, true>) {}

  async login(email: string, password: string) {
    const a = await this.db.adminUser.findUnique({ where: { email: normalizeEmail(email) } });
    const ok = await bcrypt.compare(password, a?.passwordHash ?? DUMMY_HASH);
    if (!a || !ok) throw new UnauthorizedException("That email and password don't match an admin account.");
    const updated = await this.db.adminUser.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } });
    const token = this.jwt.sign({ sub: a.id, kind: 'admin', role: a.role }, { expiresIn: this.config.get('ADMIN_TOKEN_TTL', { infer: true }) as never });
    return { token, admin: publicAdmin(updated) };
  }

  async me(id: string) {
    const a = await this.db.adminUser.findUnique({ where: { id } });
    if (!a) throw new UnauthorizedException('Admin sign-in required.');
    return publicAdmin(a);
  }
}
