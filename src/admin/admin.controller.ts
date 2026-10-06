import { Controller, Get, Module, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminGuard, Roles } from '../auth/auth.guards.js';
import { publicCustomer } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Customer lookup (for registering units) and the change log. */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}

  @Get('customers') @ApiQuery({ name: 'q', required: false, description: 'Name, email or phone' })
  async customers(@Query('q') q?: string) {
    const term = q?.trim();
    const rows = await this.db.customer.findMany({
      where: term ? { OR: [{ email: { contains: term, mode: 'insensitive' } }, { firstName: { contains: term, mode: 'insensitive' } }, { lastName: { contains: term, mode: 'insensitive' } }, { phone: { contains: term } }] } : {},
      orderBy: { createdAt: 'desc' }, take: 50,
    });
    return rows.map(publicCustomer);
  }

  @Get('customers/:id')
  async customer(@Param('id', ParseUUIDPipe) id: string) {
    const c = await this.db.customer.findUniqueOrThrow({ where: { id }, include: { addresses: true, _count: { select: { orders: true, units: true, bookings: true } } } });
    return { ...publicCustomer(c), addresses: c.addresses, counts: c._count };
  }

  @Get('audit-log') @Roles('owner')
  auditLog() {
    return this.audit.list();
  }
}

@Module({ controllers: [AdminController] })
export class AdminModule {}
