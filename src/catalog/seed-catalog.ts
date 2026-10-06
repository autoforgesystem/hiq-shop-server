import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FilterDto, PhotoDto, ProductDto } from './catalog.dto.js';

/**
 * The catalogue that ships with the site, exported from apps/src/data (products.json, catalog.ts, images.ts).
 * Used by `prisma db seed` and by the admin "reset catalogue" action. Read from disk relative to the server folder.
 */
export function readSeedCatalog(dir = resolve(process.cwd(), 'prisma/seed-data')) {
  const read = <T>(f: string) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as T;
  const photos = read<Record<string, { alt: string }>>('photos.json');
  return {
    products: read<ProductDto[]>('products.json'),
    filters: read<FilterDto[]>('filters.json'),
    photos: Object.fromEntries(Object.entries(photos).map(([k, v]) => [k, { src: null, alt: v.alt }])) as Record<string, PhotoDto>,
    needs: read<{ needs: { code: string; label: string }[] }>('lookups.json').needs,
  };
}
