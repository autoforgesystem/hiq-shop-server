import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { normalizeEmail } from '../common/util.js';
import type { Env } from '../config/env.js';
import type { CreateLeadDto, ServiceAreaDto, UpdateLeadDto } from './leads.dto.js';

@Injectable()
export class LeadsService {
  constructor(private readonly db: PrismaService, private readonly notify: NotificationsService, private readonly config: ConfigService<Env, true>) {}

  async create(dto: CreateLeadDto) {
    if (dto.website) return { id: null }; // bot filled the honeypot: pretend it worked
    const product = dto.productSlug ? await this.db.product.findUnique({ where: { slug: dto.productSlug }, select: { id: true, model: true } }) : null;
    const lead = await this.db.lead.create({
      data: {
        leadType: dto.type, name: dto.name ?? null, email: dto.email ? normalizeEmail(dto.email) : null, phone: dto.phone ?? null,
        company: dto.company ?? null, message: dto.message ?? null, productId: product?.id ?? null, details: dto.details ?? {},
        utmSource: dto.utmSource ?? null, utmMedium: dto.utmMedium ?? null, utmCampaign: dto.utmCampaign ?? null,
      },
    });
    await this.notify.email(this.config.get('SALES_EMAIL', { infer: true }), `New ${dto.type} request${product ? ` — ${product.model}` : ''}`, `${dto.name ?? ''} ${dto.email ?? ''} ${dto.phone ?? ''}\n${dto.message ?? ''}`);
    return { id: lead.id };
  }

  list(type?: string, status?: string) {
    return this.db.lead.findMany({
      where: { ...(type && { leadType: type }), ...(status && { status }) },
      include: { product: { select: { slug: true, model: true } } }, orderBy: { createdAt: 'desc' }, take: 200,
    });
  }

  update(id: string, dto: UpdateLeadDto) {
    return this.db.lead.update({ where: { id }, data: { status: dto.status } });
  }

  /** Coverage comes from SERVICE_AREAS in .env. Until HIQ confirms it, the answer is "we'll confirm by phone". */
  checkServiceArea(dto: ServiceAreaDto) {
    const areas = this.config.get('SERVICE_AREAS', { infer: true });
    if (!areas.length) return { covered: null, note: 'Service areas are being confirmed [TBC]. HIQ will call to confirm.' };
    const hit = [dto.city, dto.province].filter(Boolean).some((x) => areas.includes(x!.toLowerCase()));
    return hit ? { covered: true, note: 'We install and service in your area.' } : { covered: false, note: "We may not cover this area yet. Send a request and HIQ will check." };
  }
}
