import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { addMonths, isoDate, parseDate, todayUtc } from '../common/util.js';
import type { CreateUnitDto, ServiceRecordDto, UpdateUnitDto } from './service.dto.js';

type Tx = Prisma.TransactionClient;
const unitInclude = {
  product: { select: { slug: true, model: true } },
  address: true,
  serviceHistory: { orderBy: { serviceDate: 'desc' } },
} satisfies Prisma.UnitInclude;
type UnitRow = Prisma.UnitGetPayload<{ include: typeof unitInclude }>;

export const formatAddress = (a: { line1: string; line2?: string | null; city: string; province: string; postal?: string | null }) =>
  [a.line1, a.line2, a.city, a.province, a.postal].filter(Boolean).join(', ');

/** Shape from apps/docs/API.md: GET /me/units */
export const toApiUnit = (u: UnitRow) => ({
  id: u.id,
  productSlug: u.product.slug,
  model: u.product.model,
  configuration: u.configuration,
  serialNumber: u.serialNumber,
  installedAt: isoDate(u.installedAt),
  addressId: u.addressId,
  address: formatAddress(u.address),
  nextFilterDueAt: isoDate(u.nextFilterDueAt),
  warranty: { endsAt: isoDate(u.warrantyEndsAt), status: u.warrantyStatus },
  serviceHistory: u.serviceHistory.map((h) => ({ date: isoDate(h.serviceDate), type: h.serviceType, notes: h.notes, technician: h.technicianName })),
});

@Injectable()
export class UnitsService {
  constructor(private readonly db: PrismaService) {}

  async forCustomer(customerId: string) {
    const rows = await this.db.unit.findMany({ where: { customerId }, include: unitInclude, orderBy: { installedAt: 'desc' } });
    return rows.map(toApiUnit);
  }

  async ownedBy(unitId: string, customerId: string) {
    const u = await this.db.unit.findFirst({ where: { id: unitId, customerId }, include: { product: true } });
    if (!u) throw new NotFoundException('Unit not found on your account.');
    return u;
  }

  /** Filters to replace on each unit, with the due date. Shape from API.md: GET /me/filters/due */
  async filtersDue(customerId: string) {
    const units = await this.db.unit.findMany({
      where: { customerId, nextFilterDueAt: { not: null } },
      include: { product: { include: { compatibleWith: { include: { filterSku: true } } } } },
      orderBy: { nextFilterDueAt: 'asc' },
    });
    const today = todayUtc().getTime();
    return units.flatMap((u) =>
      u.product.compatibleWith.map(({ filterSku: f }) => ({
        unitId: u.id, model: u.product.model, filterSkuId: f.id, filterSku: f.sku, name: f.name, stage: f.stage,
        dueAt: isoDate(u.nextFilterDueAt), daysLeft: Math.round((u.nextFilterDueAt!.getTime() - today) / 86_400_000),
      })),
    );
  }

  /** Shortest known replacement interval among the unit's filters, or null while intervals are [TBC]. */
  private async filterIntervalMonths(tx: Tx, productId: string) {
    const r = await tx.filterSku.aggregate({ where: { compatibleWith: { some: { productId } }, intervalMonths: { not: null } }, _min: { intervalMonths: true } });
    return r._min.intervalMonths;
  }

  /** Sets the next due date and replaces any open reminder for it. */
  private async scheduleFilters(tx: Tx, unitId: string, productId: string, from: Date) {
    const months = await this.filterIntervalMonths(tx, productId);
    const due = months ? addMonths(from, months) : null;
    await tx.filterReminder.updateMany({ where: { unitId, completedAt: null }, data: { completedAt: new Date() } });
    if (due) await tx.filterReminder.create({ data: { unitId, dueAt: due } });
    await tx.unit.update({ where: { id: unitId }, data: { nextFilterDueAt: due } });
  }

  // ── Admin ──

  async adminList(customerId?: string) {
    const rows = await this.db.unit.findMany({ where: customerId ? { customerId } : {}, include: unitInclude, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map(toApiUnit);
  }

  /** Registers an installed unit on a customer's account. */
  async create(dto: CreateUnitDto) {
    const product = await this.db.product.findUnique({ where: { slug: dto.productSlug } });
    if (!product) throw new BadRequestException(`Unknown product "${dto.productSlug}".`);
    const address = await this.db.address.findFirst({ where: { id: dto.addressId, customerId: dto.customerId } });
    if (!address) throw new BadRequestException("That address doesn't belong to this customer.");
    const order = dto.orderNumber ? await this.db.order.findUnique({ where: { orderNumber: dto.orderNumber } }) : null;
    if (dto.orderNumber && !order) throw new BadRequestException(`Unknown order "${dto.orderNumber}".`);

    const installedAt = parseDate(dto.installedAt);
    const warrantyEndsAt = dto.warrantyEndsAt ? parseDate(dto.warrantyEndsAt) : product.warrantyMonths ? addMonths(installedAt, product.warrantyMonths) : null;
    const id = await this.db.$transaction(async (tx) => {
      const u = await tx.unit.create({
        data: {
          customerId: dto.customerId, productId: product.id, addressId: address.id, orderId: order?.id ?? null, configuration: dto.configuration ?? null,
          serialNumber: dto.serialNumber ?? null, installedAt, warrantyEndsAt,
        },
      });
      await tx.serviceHistory.create({ data: { unitId: u.id, serviceDate: installedAt, serviceType: 'installation', notes: 'Installation' } });
      await this.scheduleFilters(tx, u.id, product.id, installedAt);
      return u.id;
    });
    return this.one(id);
  }

  async update(id: string, dto: UpdateUnitDto) {
    const unit = await this.db.unit.findUnique({ where: { id } });
    if (!unit) throw new NotFoundException('Unit not found.');
    await this.db.$transaction(async (tx) => {
      await tx.unit.update({
        where: { id },
        data: {
          ...(dto.warrantyEndsAt && { warrantyEndsAt: parseDate(dto.warrantyEndsAt) }),
          ...(dto.warrantyStatus && { warrantyStatus: dto.warrantyStatus }),
          ...(dto.serialNumber !== undefined && { serialNumber: dto.serialNumber }),
        },
      });
      if (dto.nextFilterDueAt) {
        const due = parseDate(dto.nextFilterDueAt);
        await tx.filterReminder.updateMany({ where: { unitId: id, completedAt: null }, data: { completedAt: new Date() } });
        await tx.filterReminder.create({ data: { unitId: id, dueAt: due } });
        await tx.unit.update({ where: { id }, data: { nextFilterDueAt: due } });
      }
    });
    return this.one(id);
  }

  /** Logs a visit. A filter replacement restarts the filter schedule from the visit date. */
  async recordService(unitId: string, dto: ServiceRecordDto & { bookingId?: string }, tx?: Tx) {
    const run = async (t: Tx) => {
      const unit = await t.unit.findUnique({ where: { id: unitId } });
      if (!unit) throw new NotFoundException('Unit not found.');
      const serviceDate = parseDate(dto.serviceDate);
      await t.serviceHistory.create({
        data: { unitId, bookingId: dto.bookingId ?? null, serviceDate, serviceType: dto.serviceType, notes: dto.notes ?? null, technicianName: dto.technicianName ?? null },
      });
      if (dto.serviceType === 'filter-replacement') await this.scheduleFilters(t, unitId, unit.productId, serviceDate);
    };
    if (tx) return run(tx);
    await this.db.$transaction(run);
    return this.one(unitId);
  }

  async one(id: string) {
    const u = await this.db.unit.findUnique({ where: { id }, include: unitInclude });
    if (!u) throw new NotFoundException('Unit not found.');
    return toApiUnit(u);
  }
}
