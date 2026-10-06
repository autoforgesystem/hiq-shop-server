import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { publicCustomer } from '../auth/auth.service.js';
import { UnitsService } from '../service/units.service.js';
import { addMonths, isoDate, todayUtc } from '../common/util.js';
import type { Env } from '../config/env.js';
import type { AddressDto, ChangePasswordDto, CreateSubscriptionDto, UpdateProfileDto } from './me.dto.js';

const addressSelect = { id: true, label: true, line1: true, line2: true, city: true, province: true, postal: true, isDefault: true } as const;

@Injectable()
export class MeService {
  constructor(private readonly db: PrismaService, private readonly units: UnitsService, private readonly config: ConfigService<Env, true>) {}

  async updateProfile(id: string, dto: UpdateProfileDto) {
    return publicCustomer(await this.db.customer.update({ where: { id }, data: { ...dto, ...(dto.phone && { phone: dto.phone.trim() }) } }));
  }

  async changePassword(id: string, dto: ChangePasswordDto) {
    const c = await this.db.customer.findUniqueOrThrow({ where: { id } });
    if (c.passwordHash && !(dto.currentPassword && (await bcrypt.compare(dto.currentPassword, c.passwordHash)))) throw new UnauthorizedException('Your current password is not right.');
    await this.db.customer.update({ where: { id }, data: { passwordHash: await bcrypt.hash(dto.newPassword, 12) } });
  }

  // ── Addresses ──

  addresses(customerId: string) {
    return this.db.address.findMany({ where: { customerId }, select: addressSelect, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  }

  /** The first address is the default; making one the default clears the others. */
  async addAddress(customerId: string, dto: AddressDto) {
    const count = await this.db.address.count({ where: { customerId } });
    const isDefault = dto.isDefault || count === 0;
    return this.db.$transaction(async (tx) => {
      if (isDefault) await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      return tx.address.create({ data: { ...dto, customerId, isDefault }, select: addressSelect });
    });
  }

  async updateAddress(customerId: string, id: string, dto: AddressDto) {
    await this.ownAddress(customerId, id);
    return this.db.$transaction(async (tx) => {
      if (dto.isDefault) await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: { ...dto, isDefault: dto.isDefault ?? undefined }, select: addressSelect });
    });
  }

  async deleteAddress(customerId: string, id: string) {
    const a = await this.ownAddress(customerId, id);
    if (await this.db.unit.count({ where: { addressId: id } })) throw new BadRequestException('A unit is installed at this address, so it can’t be removed.');
    await this.db.address.delete({ where: { id } });
    if (a.isDefault) {
      const next = await this.db.address.findFirst({ where: { customerId }, orderBy: { createdAt: 'asc' } });
      if (next) await this.db.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }

  private async ownAddress(customerId: string, id: string) {
    const a = await this.db.address.findFirst({ where: { id, customerId } });
    if (!a) throw new NotFoundException('Address not found.');
    return a;
  }

  // ── Subscriptions (Subscribe & Save, [CONFIRM SUBSCRIPTION OFFER]) ──

  async subscriptions(customerId: string) {
    const rows = await this.db.subscription.findMany({ where: { customerId }, include: { items: { include: { filterSku: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map((s) => ({
      id: s.id, unitId: s.unitId, filterSkus: s.items.map((i) => i.filterSku.sku), filters: s.items.map((i) => ({ id: i.filterSkuId, name: i.filterSku.name, qty: i.qty })),
      intervalMonths: s.intervalMonths, nextShipAt: isoDate(s.nextShipAt), status: s.status,
    }));
  }

  async subscribe(customerId: string, dto: CreateSubscriptionDto) {
    if (!this.config.get('SUBSCRIPTIONS_ENABLED', { infer: true })) throw new ForbiddenException('Subscribe & Save is not available yet.');
    const unit = await this.units.ownedBy(dto.unitId, customerId);
    const filters = await this.db.filterSku.findMany({ where: { id: { in: dto.filterSkuIds }, compatibleWith: { some: { productId: unit.productId } } } });
    if (filters.length !== new Set(dto.filterSkuIds).size) throw new BadRequestException('Choose filters that fit this unit.');
    const interval = dto.intervalMonths ?? Math.min(...filters.map((f) => f.intervalMonths ?? Infinity));
    if (!Number.isFinite(interval)) throw new BadRequestException('Replacement intervals for these filters are not confirmed yet. Choose an interval.');
    const s = await this.db.subscription.create({
      data: { customerId, unitId: unit.id, intervalMonths: interval, nextShipAt: unit.nextFilterDueAt ?? addMonths(todayUtc(), interval), items: { create: filters.map((f) => ({ filterSkuId: f.id })) } },
    });
    return (await this.subscriptions(customerId)).find((x) => x.id === s.id);
  }

  async cancelSubscription(customerId: string, id: string) {
    const r = await this.db.subscription.updateMany({ where: { id, customerId }, data: { status: 'cancelled' } });
    if (!r.count) throw new NotFoundException('Subscription not found.');
  }

  // ── Loyalty ([CONFIRM PROGRAMME]) ──

  async loyalty(customerId: string) {
    const history = await this.db.loyaltyTransaction.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, select: { points: true, reason: true, createdAt: true } });
    return { points: history.reduce((s, h) => s + h.points, 0), history };
  }
}
