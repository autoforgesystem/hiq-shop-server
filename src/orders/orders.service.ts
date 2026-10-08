import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { isoDate, normalizeEmail, parseDate, randomCode, todayUtc, toPesos } from '../common/util.js';
import type { CreateOrderDto, UpdateOrderStatusDto } from './orders.dto.js';

const orderInclude = { lines: true } satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export const toApiOrder = (o: OrderRow) => ({
  id: o.orderNumber,
  createdAt: o.createdAt,
  status: o.status,
  contact: { name: o.contactName, email: o.contactEmail, phone: o.contactPhone },
  shipping: { line1: o.shipLine1, city: o.shipCity, province: o.shipProvince, postal: o.shipPostal },
  paymentMethod: o.paymentMethod,
  install: o.installPreferredDate || o.installPreferredSlot ? { date: isoDate(o.installPreferredDate), slot: o.installPreferredSlot } : null,
  lines: o.lines.map((l) => ({
    name: l.name, qty: l.qty, mode: l.mode, configuration: l.configuration, withInstallation: l.withInstallation,
    unitPrice: toPesos(l.unitPriceCentavos), productId: l.productId, filterSkuId: l.filterSkuId, sparePartId: l.sparePartId,
  })),
  subtotal: toPesos(o.subtotalCentavos),
  deliveryFee: toPesos(o.deliveryFeeCentavos),
  total: toPesos(o.totalCentavos),
  requiresQuote: o.requiresQuote,
  currency: 'PHP',
});

@Injectable()
export class OrdersService {
  constructor(private readonly db: PrismaService, private readonly notify: NotificationsService) {}

  /** Prices come from the database, never from the request. Lines without a confirmed price are flagged for a quote. */
  async create(dto: CreateOrderDto, customerId?: string) {
    const lines: Prisma.OrderLineCreateWithoutOrderInput[] = [];
    for (const l of dto.lines) {
      if ([l.productSlug, l.filterSkuId, l.sparePartSlug].filter(Boolean).length > 1) throw new BadRequestException('A line is one product, filter or spare part, not several.');
      if (l.sparePartSlug) {
        const part = await this.db.sparePart.findFirst({ where: { slug: l.sparePartSlug, isHidden: false } });
        if (!part) throw new BadRequestException(`Spare part "${l.sparePartSlug}" is not available.`);
        lines.push({ sparePart: { connect: { id: part.id } }, name: part.name, qty: l.qty, mode: 'buy', unitPriceCentavos: part.priceCentavos });
        continue;
      }
      if (l.qty > 20) throw new BadRequestException('Order up to 20 of each system or filter online. For more, send a quote request.');
      if (l.productSlug) {
        const p = await this.db.product.findFirst({ where: { slug: l.productSlug, isHidden: false }, include: { configurations: { include: { configuration: true } } } });
        if (!p) throw new BadRequestException(`Product "${l.productSlug}" is not available.`);
        if (p.channel !== 'shop') throw new BadRequestException(`${p.model} is sold by quote only. Send a quote request instead.`);
        const configs = p.configurations.map((c) => c.configuration.name);
        if (l.configuration && !configs.includes(l.configuration)) throw new BadRequestException(`${p.model} doesn't come in "${l.configuration}".`);
        const mode = l.mode ?? 'buy';
        lines.push({
          product: { connect: { id: p.id } }, name: p.model, qty: l.qty, mode, configuration: l.configuration ?? null,
          withInstallation: !!l.withInstallation, unitPriceCentavos: mode === 'rent' ? null : p.priceCentavos, // rental is always quoted
        });
      } else {
        const f = await this.db.filterSku.findUnique({ where: { id: l.filterSkuId! } });
        if (!f) throw new BadRequestException('That replacement filter is not available.');
        lines.push({ filterSku: { connect: { id: f.id } }, name: f.name, qty: l.qty, mode: 'buy', unitPriceCentavos: f.priceCentavos });
      }
    }

    const install = dto.install?.date ? parseDate(dto.install.date) : null;
    if (install && install <= todayUtc()) throw new BadRequestException('Pick an installation date from tomorrow onwards.');

    const subtotal = lines.reduce((s, l) => s + (l.unitPriceCentavos ?? 0) * l.qty, 0);
    const requiresQuote = lines.some((l) => l.unitPriceCentavos == null);
    const deliveryFee = null; // [TBC]: set once HIQ confirms delivery fees
    const order = await this.db.order.create({
      data: {
        orderNumber: await this.newOrderNumber(),
        customerId: customerId ?? null,
        contactName: dto.contact.name, contactEmail: normalizeEmail(dto.contact.email), contactPhone: dto.contact.phone.trim(),
        shipLine1: dto.shipping.line1, shipCity: dto.shipping.city, shipProvince: dto.shipping.province, shipPostal: dto.shipping.postal || null,
        paymentMethod: dto.paymentMethod, subtotalCentavos: subtotal, deliveryFeeCentavos: deliveryFee, totalCentavos: subtotal + (deliveryFee ?? 0),
        requiresQuote, installPreferredDate: install, installPreferredSlot: dto.install?.slot ?? null,
        lines: { create: lines },
      },
      include: orderInclude,
    });
    await this.notify.email(order.contactEmail, `HIQ order ${order.orderNumber} received`, `Thank you, ${order.contactName}. HIQ will call you to confirm${requiresQuote ? ' prices and' : ''} delivery.`);
    return toApiOrder(order);
  }

  private async newOrderNumber() {
    for (;;) {
      const n = `HIQ-${randomCode(6)}`;
      if (!(await this.db.order.findUnique({ where: { orderNumber: n }, select: { id: true } }))) return n;
    }
  }

  /** The owner can always see their order; a guest needs the email used at checkout. */
  async findOne(orderNumber: string, customerId?: string, email?: string) {
    const o = await this.db.order.findUnique({ where: { orderNumber: orderNumber.toUpperCase() }, include: orderInclude });
    const allowed = o && ((customerId && o.customerId === customerId) || (email && normalizeEmail(email) === o.contactEmail));
    if (!allowed) throw new NotFoundException('Order not found. Check the order number and email.');
    return toApiOrder(o);
  }

  async forCustomer(customerId: string) {
    const rows = await this.db.order.findMany({ where: { customerId }, include: orderInclude, orderBy: { createdAt: 'desc' } });
    return rows.map(toApiOrder);
  }

  async adminList(status?: string) {
    const rows = await this.db.order.findMany({ where: status ? { status } : {}, include: orderInclude, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map(toApiOrder);
  }

  async updateStatus(orderNumber: string, dto: UpdateOrderStatusDto) {
    const o = await this.db.order.update({
      where: { orderNumber },
      data: { status: dto.status, ...(dto.platformOrderRef !== undefined && { platformOrderRef: dto.platformOrderRef }) },
      include: orderInclude,
    });
    return toApiOrder(o);
  }
}
