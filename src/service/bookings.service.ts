import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ServiceBooking } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { isoDate, normalizeEmail, parseDate, todayUtc } from '../common/util.js';
import { formatAddress, UnitsService } from './units.service.js';
import type { CreateBookingDto, CreateClaimDto, UpdateBookingDto, UpdateClaimDto } from './service.dto.js';

/** Shape from apps/docs/API.md: GET /me/bookings */
export const toApiBooking = (b: ServiceBooking) => ({
  id: b.id, service: b.service, unitId: b.unitId ?? 'new', preferredDate: isoDate(b.preferredDate), preferredSlot: b.preferredSlot,
  address: b.visitAddress, contact: { name: b.contactName, phone: b.contactPhone, email: b.contactEmail }, notes: b.notes,
  status: b.status, createdAt: b.createdAt,
});

@Injectable()
export class BookingsService {
  constructor(private readonly db: PrismaService, private readonly units: UnitsService, private readonly notify: NotificationsService) {}

  /** Service booking from /service/book. Guests can book; signed-in customers can pick their unit and saved address. */
  async create(dto: CreateBookingDto, customerId?: string) {
    if ((dto.unitId || dto.addressId) && !customerId) throw new BadRequestException('Sign in to book for a saved unit or address.');
    let unitId = dto.unitId ?? null;
    let modelNote: string | null = null;
    if (unitId) await this.units.ownedBy(unitId, customerId!);
    else if (dto.unit && dto.unit !== 'new') {
      // The form sends a product slug. Link the customer's unit of that model when there is exactly one.
      const product = await this.db.product.findUnique({ where: { slug: dto.unit } });
      if (!product) throw new BadRequestException(`Unknown model "${dto.unit}".`);
      const owned = customerId ? await this.db.unit.findMany({ where: { customerId, productId: product.id }, select: { id: true } }) : [];
      if (owned.length === 1) unitId = owned[0].id;
      else modelNote = `Model: ${product.model}`;
    } else if (dto.unit === 'new') modelNote = 'New installation';

    let visitAddress: string;
    if (dto.addressId) {
      const a = await this.db.address.findFirst({ where: { id: dto.addressId, customerId } });
      if (!a) throw new BadRequestException('Address not found on your account.');
      visitAddress = formatAddress(a);
    } else {
      if (!dto.address || !dto.city) throw new BadRequestException('Enter the service address and city.');
      visitAddress = `${dto.address}, ${dto.city}`;
    }
    const date = dto.date ? parseDate(dto.date) : null;
    if (date && date <= todayUtc()) throw new BadRequestException('Pick a preferred date from tomorrow onwards.');

    const booking = await this.db.$transaction(async (tx) => {
      const b = await tx.serviceBooking.create({
        data: {
          customerId: customerId ?? null, unitId, addressId: dto.addressId ?? null, contactName: dto.name, contactPhone: dto.phone.trim(),
          contactEmail: dto.email ? normalizeEmail(dto.email) : null, visitAddress, service: dto.service, preferredDate: date,
          preferredSlot: dto.slot ?? null, notes: [modelNote, dto.notes].filter(Boolean).join('\n') || null,
        },
      });
      // A warranty booking for a known unit also opens a warranty claim.
      if (dto.service === 'warranty' && unitId) await tx.warrantyClaim.create({ data: { unitId, bookingId: b.id, description: dto.notes || 'Warranty service requested' } });
      return b;
    });
    await this.notify.sms(booking.contactPhone, `HIQ received your ${booking.service.replace('-', ' ')} booking. We'll call to confirm the schedule.`);
    return toApiBooking(booking);
  }

  async forCustomer(customerId: string) {
    const rows = await this.db.serviceBooking.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
    return rows.map(toApiBooking);
  }

  async adminList(status?: string) {
    const rows = await this.db.serviceBooking.findMany({ where: status ? { status } : {}, orderBy: [{ preferredDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], take: 200 });
    return rows.map(toApiBooking);
  }

  /** Marking a booking done logs it in the unit's service history (and restarts the filter schedule for filter replacements). */
  async update(id: string, dto: UpdateBookingDto) {
    const b = await this.db.serviceBooking.findUnique({ where: { id }, include: { history: true } });
    if (!b) throw new NotFoundException('Booking not found.');
    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.serviceBooking.update({ where: { id }, data: { status: dto.status } });
      if (dto.status === 'done' && b.unitId && !b.history) {
        await this.units.recordService(b.unitId, {
          bookingId: id, serviceType: b.service, serviceDate: dto.serviceDate ?? isoDate(todayUtc())!, notes: dto.notes, technicianName: dto.technicianName,
        }, tx);
      }
      return row;
    });
    return toApiBooking(updated);
  }

  // ── Warranty claims ──

  async createClaim(customerId: string, dto: CreateClaimDto) {
    const unit = await this.units.ownedBy(dto.unitId, customerId);
    if (unit.warrantyStatus !== 'active') throw new BadRequestException('This unit is no longer under warranty. Book a troubleshooting visit instead.');
    const c = await this.db.warrantyClaim.create({ data: { unitId: unit.id, description: dto.description } });
    return { id: c.id, status: c.status };
  }

  claimsFor(customerId: string) {
    return this.db.warrantyClaim.findMany({ where: { unit: { customerId } }, orderBy: { createdAt: 'desc' }, select: { id: true, unitId: true, description: true, status: true, createdAt: true } });
  }

  adminClaims(status?: string) {
    return this.db.warrantyClaim.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200, include: { unit: { select: { product: { select: { model: true } }, customer: { select: { firstName: true, lastName: true, phone: true } } } } } });
  }

  async updateClaim(id: string, dto: UpdateClaimDto) {
    const c = await this.db.warrantyClaim.update({ where: { id }, data: { status: dto.status } });
    return { id: c.id, status: c.status };
  }
}
