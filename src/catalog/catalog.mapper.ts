import type { Prisma } from '../generated/prisma/client.js';
import { toPesos } from '../common/util.js';

export const productInclude = {
  images: { orderBy: { sortOrder: 'asc' } },
  specs: { orderBy: { sortOrder: 'asc' } },
  needs: { include: { need: true } },
  filtrations: { include: { filtrationType: true } },
  configurations: { include: { configuration: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.ProductInclude;

export const filterInclude = { compatibleWith: { include: { product: { select: { slug: true } } } } } satisfies Prisma.FilterSkuInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
type FilterRow = Prisma.FilterSkuGetPayload<{ include: typeof filterInclude }>;

/** The front-end `Product` shape (apps/src/data/types.ts). */
export const toApiProduct = (p: ProductRow) => ({
  slug: p.slug,
  model: p.model,
  category: p.category,
  channel: p.channel,
  needs: p.needs.map((n) => n.need.code),
  filtration: p.filtrations.map((f) => f.filtrationType.code),
  configurations: p.configurations.map((c) => c.configuration.name),
  hotCold: p.hotCold,
  install: p.install,
  ...(p.tdsLimit != null && { tdsLimit: p.tdsLimit }),
  ...(p.isEntry && { entry: true }),
  ...(p.isBottleless && { bottleless: true }),
  ...(p.isTableTop && { tableTop: true }),
  ...(p.isOffice && { office: true }),
  summary: p.summary,
  highlights: p.highlights as string[],
  specs: Object.fromEntries(p.specs.map((s) => [s.specKey, s.specValue])),
  price: toPesos(p.priceCentavos),
  warrantyMonths: p.warrantyMonths,
  ...(p.warrantyTbc && { warrantyTbc: true }),
  storeUrl: p.storeUrl,
  ...(p.featuredRank != null && { featured: p.featuredRank }),
  images: p.images.map((i) => ({ src: i.src, alt: i.alt })),
  ...(p.isHidden && { hidden: true }),
});

/** The front-end `FilterSku` shape. */
export const toApiFilter = (f: FilterRow) => ({
  id: f.id,
  sku: f.sku,
  name: f.name,
  stage: f.stage,
  compatibleModels: f.compatibleWith.map((c) => c.product.slug),
  intervalMonths: f.intervalMonths,
  price: toPesos(f.priceCentavos),
  ...(f.note && { note: f.note }),
});
