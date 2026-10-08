import { BadRequestException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { toCentavos } from '../common/util.js';
import type { FilterDto, ImportFilterDto, PhotoDto, ProductDto, SparePartDto } from './catalog.dto.js';

type Tx = Prisma.TransactionClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTRATION_LABELS: Record<string, string> = { UF: 'Ultrafiltration', Nano: 'Nanofiltration', RO: 'Reverse osmosis', UV: 'UV sterilisation', Alkaline: 'Alkaline' };

/**
 * All catalogue writes. Plain class (no Nest DI) so `prisma/seed.ts` can use it too.
 * Every method takes a transaction client, so callers decide what is atomic.
 */
export class CatalogWriter {
  constructor(private readonly db: PrismaClient) {}

  transaction<T>(fn: (tx: Tx) => Promise<T>) {
    return this.db.$transaction(fn, { timeout: 120_000, maxWait: 20_000 });
  }

  async saveProduct(tx: Tx, p: ProductDto) {
    const data = {
      model: p.model, category: p.category, channel: p.channel, hotCold: p.hotCold, install: p.install,
      tdsLimit: p.tdsLimit ?? null, isEntry: !!p.entry, isBottleless: !!p.bottleless, isTableTop: !!p.tableTop, isOffice: !!p.office,
      summary: p.summary, highlights: p.highlights, priceCentavos: toCentavos(p.price), warrantyMonths: p.warrantyMonths ?? null,
      warrantyTbc: !!p.warrantyTbc, storeUrl: p.storeUrl ?? null, featuredRank: p.featured ?? null, isHidden: !!p.hidden,
    };
    const row = await tx.product.upsert({ where: { slug: p.slug }, create: { slug: p.slug, ...data }, update: data });
    const productId = row.id;

    await tx.productImage.deleteMany({ where: { productId } });
    await tx.productSpec.deleteMany({ where: { productId } });
    await tx.productNeed.deleteMany({ where: { productId } });
    await tx.productFiltration.deleteMany({ where: { productId } });
    await tx.productConfiguration.deleteMany({ where: { productId } });

    if (p.images?.length) await tx.productImage.createMany({ data: p.images.map((i, n) => ({ productId, src: i.src, alt: i.alt, sortOrder: n })) });
    const specs = Object.entries(p.specs);
    if (specs.length) await tx.productSpec.createMany({ data: specs.map(([specKey, specValue], n) => ({ productId, specKey, specValue, sortOrder: n })) });
    for (const code of new Set(p.needs)) {
      const need = await tx.need.upsert({ where: { code }, create: { code, label: code[0].toUpperCase() + code.slice(1) }, update: {} });
      await tx.productNeed.create({ data: { productId, needId: need.id } });
    }
    for (const code of new Set(p.filtration)) {
      const ft = await tx.filtrationType.upsert({ where: { code }, create: { code, label: FILTRATION_LABELS[code] ?? code }, update: {} });
      await tx.productFiltration.create({ data: { productId, filtrationTypeId: ft.id } });
    }
    for (const [n, name] of [...new Set(p.configurations)].entries()) {
      const cfg = await tx.configuration.upsert({ where: { name }, create: { name }, update: {} });
      await tx.productConfiguration.create({ data: { productId, configurationId: cfg.id, sortOrder: n } });
    }
    return row;
  }

  /** Creates a filter, or updates it when `id` is given. Compatible models are product slugs. */
  async saveFilter(tx: Tx, f: FilterDto, id?: string, sortOrder?: number) {
    const products = await tx.product.findMany({ where: { slug: { in: f.compatibleModels } }, select: { id: true, slug: true } });
    const missing = f.compatibleModels.filter((s) => !products.some((p) => p.slug === s));
    if (missing.length) throw new BadRequestException(`Unknown product slug(s) in compatibleModels: ${missing.join(', ')}`);
    const data = { sku: f.sku, name: f.name, stage: f.stage, intervalMonths: f.intervalMonths ?? null, priceCentavos: toCentavos(f.price), note: f.note ?? null, ...(sortOrder != null && { sortOrder }) };
    const row = id ? await tx.filterSku.update({ where: { id }, data }) : await tx.filterSku.create({ data });
    await tx.filterCompatibility.deleteMany({ where: { filterSkuId: row.id } });
    if (products.length) await tx.filterCompatibility.createMany({ data: products.map((p) => ({ filterSkuId: row.id, productId: p.id })) });
    return row;
  }

  /** Creates or updates a spare part by slug. Compatible models are product slugs; none means it fits any system. */
  async saveSparePart(tx: Tx, p: SparePartDto, sortOrder?: number) {
    const products = await tx.product.findMany({ where: { slug: { in: p.compatibleModels } }, select: { id: true, slug: true } });
    const missing = p.compatibleModels.filter((s) => !products.some((x) => x.slug === s));
    if (missing.length) throw new BadRequestException(`Unknown product slug(s) in compatibleModels: ${missing.join(', ')}`);
    const data = {
      sku: p.sku, name: p.name, category: p.category, description: p.description ?? '', specs: p.specs, images: (p.images ?? []).map((i) => ({ src: i.src, alt: i.alt })),
      unit: p.unit, priceCentavos: toCentavos(p.price), isHidden: !!p.hidden, ...(sortOrder != null && { sortOrder }),
    };
    const row = await tx.sparePart.upsert({ where: { slug: p.slug }, create: { slug: p.slug, ...data }, update: data });
    await tx.sparePartCompatibility.deleteMany({ where: { sparePartId: row.id } });
    if (products.length) await tx.sparePartCompatibility.createMany({ data: products.map((x) => ({ sparePartId: row.id, productId: x.id })) });
    return row;
  }

  /** Replaces all spare parts with `parts` (import, reset and the first seed). */
  async replaceSpareParts(tx: Tx, parts: SparePartDto[]) {
    if (new Set(parts.map((p) => p.slug)).size !== parts.length) throw new BadRequestException('Two spare parts in the import share a slug.');
    for (const [n, p] of parts.entries()) await this.saveSparePart(tx, p, n);
    await tx.sparePart.deleteMany({ where: { slug: { notIn: parts.map((p) => p.slug) } } });
    return parts.length;
  }

  async savePhoto(tx: Tx, key: string, photo: PhotoDto) {
    return tx.sitePhoto.upsert({ where: { photoKey: key }, create: { photoKey: key, src: photo.src ?? null, alt: photo.alt }, update: { src: photo.src ?? null, alt: photo.alt } });
  }

  /**
   * Replaces the catalogue with `data` (admin import and reset). Products that installed units still point to
   * are hidden instead of deleted; filters not in `data` are deleted. Spare parts are replaced only when `data.parts` is given.
   */
  async replaceAll(tx: Tx, data: { products: ProductDto[]; filters: ImportFilterDto[]; parts?: SparePartDto[]; photos?: Record<string, PhotoDto> }) {
    const slugs = new Set(data.products.map((p) => p.slug));
    if (slugs.size !== data.products.length) throw new BadRequestException('Two products in the import share a slug.');
    for (const p of data.products) await this.saveProduct(tx, p);

    const gone = await tx.product.findMany({ where: { slug: { notIn: [...slugs] } }, select: { id: true, _count: { select: { units: true } } } });
    const keep = gone.filter((g) => g._count.units > 0).map((g) => g.id);
    if (keep.length) await tx.product.updateMany({ where: { id: { in: keep } }, data: { isHidden: true } });
    await tx.product.deleteMany({ where: { id: { in: gone.filter((g) => !g._count.units).map((g) => g.id) } } });

    const kept: string[] = [];
    for (const [n, f] of data.filters.entries()) {
      const existing = f.id && UUID.test(f.id) ? await tx.filterSku.findUnique({ where: { id: f.id }, select: { id: true } }) : null;
      kept.push((await this.saveFilter(tx, f, existing?.id, n)).id);
    }
    await tx.filterSku.deleteMany({ where: { id: { notIn: kept } } });
    const parts = data.parts ? await this.replaceSpareParts(tx, data.parts) : await tx.sparePart.count();

    if (data.photos) {
      for (const [key, photo] of Object.entries(data.photos)) await this.savePhoto(tx, key, photo);
    }
    return { products: data.products.length, hidden: keep.length, filters: kept.length, parts };
  }

  async seedNeeds(tx: Tx, needs: { code: string; label: string }[]) {
    for (const n of needs) await tx.need.upsert({ where: { code: n.code }, create: n, update: { label: n.label } });
  }
}
