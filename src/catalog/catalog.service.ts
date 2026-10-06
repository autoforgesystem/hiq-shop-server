import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CatalogWriter } from './catalog-writer.js';
import { filterInclude, productInclude, toApiFilter, toApiProduct } from './catalog.mapper.js';
import { readSeedCatalog } from './seed-catalog.js';
import type { CatalogImportDto, FilterDto, PhotoDto, ProductDto, ProductQueryDto } from './catalog.dto.js';

@Injectable()
export class CatalogService {
  private readonly writer: CatalogWriter;

  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {
    this.writer = new CatalogWriter(db);
  }

  // ── Storefront ──

  private async products(where: Prisma.ProductWhereInput) {
    const rows = await this.db.product.findMany({ where, include: productInclude, orderBy: [{ featuredRank: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] });
    return rows.map(toApiProduct);
  }

  private async filters(where: Prisma.FilterSkuWhereInput = {}) {
    const rows = await this.db.filterSku.findMany({ where, include: filterInclude, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(toApiFilter);
  }

  private async photos() {
    const rows = await this.db.sitePhoto.findMany({ where: { src: { not: null } } });
    return Object.fromEntries(rows.map((r) => [r.photoKey, { src: r.src, alt: r.alt }]));
  }

  /** Everything the storefront needs in one call, same shape as `CatalogData` in the front-end. */
  async publicCatalog() {
    const [products, filters, photos] = await Promise.all([
      this.products({ isHidden: false }),
      this.filters({ compatibleWith: { some: { product: { isHidden: false } } } }),
      this.photos(),
    ]);
    return { products, filters, photos };
  }

  listProducts(q: ProductQueryDto) {
    return this.products({
      isHidden: false,
      ...(q.category && { category: q.category }),
      ...(q.channel && { channel: q.channel }),
      ...(q.need && { needs: { some: { need: { code: q.need } } } }),
    });
  }

  async getProduct(slug: string) {
    const row = await this.db.product.findFirst({ where: { slug, isHidden: false }, include: productInclude });
    if (!row) throw new NotFoundException('Product not found.');
    return { ...toApiProduct(row), filters: await this.filters({ compatibleWith: { some: { productId: row.id } } }) };
  }

  filtersFor(model?: string) {
    return this.filters(model ? { compatibleWith: { some: { product: { slug: model, isHidden: false } } } } : { compatibleWith: { some: { product: { isHidden: false } } } });
  }

  // ── Admin ──

  async adminCatalog() {
    const [products, filters, photoRows] = await Promise.all([this.products({}), this.filters(), this.db.sitePhoto.findMany()]);
    return { products, filters, photos: Object.fromEntries(photoRows.filter((r) => r.src).map((r) => [r.photoKey, { src: r.src, alt: r.alt }])) };
  }

  private async productBySlug(slug: string) {
    const row = await this.db.product.findUnique({ where: { slug }, include: productInclude });
    if (!row) throw new NotFoundException('Product not found.');
    return toApiProduct(row);
  }

  async createProduct(adminId: string, dto: ProductDto) {
    if (await this.db.product.findUnique({ where: { slug: dto.slug } })) throw new ConflictException(`A product with the slug "${dto.slug}" already exists.`);
    await this.writer.transaction((tx) => this.writer.saveProduct(tx, dto));
    await this.audit.log(adminId, 'products', dto.slug, 'create', { model: dto.model });
    return this.productBySlug(dto.slug);
  }

  async updateProduct(adminId: string, slug: string, dto: ProductDto) {
    if (dto.slug !== slug) throw new ConflictException("A product's slug can't be changed after it is created.");
    await this.productBySlug(slug);
    await this.writer.transaction((tx) => this.writer.saveProduct(tx, dto));
    await this.audit.log(adminId, 'products', slug, 'update', { model: dto.model, price: dto.price, hidden: !!dto.hidden });
    return this.productBySlug(slug);
  }

  async deleteProduct(adminId: string, slug: string) {
    const p = await this.db.product.findUnique({ where: { slug }, include: { _count: { select: { units: true } } } });
    if (!p) throw new NotFoundException('Product not found.');
    if (p._count.units) throw new ConflictException('Customers have this product installed, so it can only be hidden, not deleted.');
    await this.db.product.delete({ where: { id: p.id } });
    await this.audit.log(adminId, 'products', slug, 'delete', { model: p.model });
  }

  private async filterById(id: string) {
    const row = await this.db.filterSku.findUnique({ where: { id }, include: filterInclude });
    if (!row) throw new NotFoundException('Filter not found.');
    return toApiFilter(row);
  }

  async createFilter(adminId: string, dto: FilterDto) {
    const row = await this.writer.transaction((tx) => this.writer.saveFilter(tx, dto));
    await this.audit.log(adminId, 'filter_skus', row.id, 'create', { name: dto.name });
    return this.filterById(row.id);
  }

  async updateFilter(adminId: string, id: string, dto: FilterDto) {
    await this.filterById(id);
    await this.writer.transaction((tx) => this.writer.saveFilter(tx, dto, id));
    await this.audit.log(adminId, 'filter_skus', id, 'update', { name: dto.name, price: dto.price, intervalMonths: dto.intervalMonths });
    return this.filterById(id);
  }

  async deleteFilter(adminId: string, id: string) {
    await this.filterById(id);
    await this.db.filterSku.delete({ where: { id } });
    await this.audit.log(adminId, 'filter_skus', id, 'delete');
  }

  async savePhoto(adminId: string, key: string, dto: PhotoDto) {
    const row = await this.writer.savePhoto(this.db, key, dto);
    await this.audit.log(adminId, 'site_photos', key, 'update', { alt: dto.alt });
    return { key: row.photoKey, src: row.src, alt: row.alt };
  }

  /** Puts a photo slot back to its labelled placeholder. */
  async resetPhoto(adminId: string, key: string) {
    const seed = readSeedCatalog().photos[key];
    if (!seed) throw new NotFoundException('Unknown photo slot.');
    await this.writer.savePhoto(this.db, key, seed);
    await this.audit.log(adminId, 'site_photos', key, 'reset');
  }

  async importCatalog(adminId: string, dto: CatalogImportDto) {
    const result = await this.writer.transaction((tx) => this.writer.replaceAll(tx, dto));
    await this.audit.log(adminId, 'catalog', null, 'import', result);
    return result;
  }

  async resetCatalog(adminId: string) {
    const seed = readSeedCatalog();
    const result = await this.writer.transaction(async (tx) => {
      await this.writer.seedNeeds(tx, seed.needs);
      return this.writer.replaceAll(tx, seed);
    });
    await this.audit.log(adminId, 'catalog', null, 'reset', result);
    return result;
  }
}
