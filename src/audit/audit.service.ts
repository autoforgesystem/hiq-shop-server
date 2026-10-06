import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Records who changed what in the admin. */
@Injectable()
export class AuditService {
  constructor(private readonly db: PrismaService) {}

  async log(adminUserId: string | undefined, entity: string, entityId: string | null, action: string, changes: Prisma.InputJsonValue = {}) {
    await this.db.auditLog.create({ data: { adminUserId: adminUserId ?? null, entity, entityId, action, changes } });
  }

  list(take = 100) {
    return this.db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take, include: { adminUser: { select: { name: true, email: true } } } });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
