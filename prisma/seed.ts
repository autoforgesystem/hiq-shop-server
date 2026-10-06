/**
 * Seeds the catalogue (from prisma/seed-data, exported from apps/src/data), the first admin user, and,
 * when SEED_DEMO=true, the demo customers that match apps/src/pages/account/mockData.ts.
 * Safe to run more than once. Run with: npm run db:seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { CatalogWriter } from '../src/catalog/catalog-writer.js';
import { readSeedCatalog } from '../src/catalog/seed-catalog.js';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: 1 }) });
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function seedCatalog() {
  const writer = new CatalogWriter(db);
  const seed = readSeedCatalog();
  if (await db.product.count()) return console.log('Catalogue already loaded, skipped (use the admin "reset catalogue" to reload it).');
  const r = await writer.transaction(async (tx) => {
    await writer.seedNeeds(tx, seed.needs);
    return writer.replaceAll(tx, seed);
  });
  console.log(`Catalogue: ${r.products} products, ${r.filters} filters, ${Object.keys(seed.photos).length} photo slots`);
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set, no admin user created.');
  if (password.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters.');
  await db.adminUser.upsert({
    where: { email },
    create: { email, name: process.env.ADMIN_NAME ?? 'HIQ Admin', role: 'owner', passwordHash: await bcrypt.hash(password, 12) },
    update: {},
  });
  console.log(`Admin user: ${email} (owner)`);
}

async function seedDemo() {
  if (process.env.SEED_DEMO !== 'true') return;
  const passwordHash = await bcrypt.hash('demo1234', 12);
  const juan = await db.customer.upsert({
    where: { email: 'juan@example.com' }, update: {},
    create: { firstName: 'Juan', lastName: 'dela Cruz', email: 'juan@example.com', phone: '0917 123 4567', passwordHash, createdAt: d('2025-11-01') },
  });
  await db.customer.upsert({
    where: { email: 'maria@example.com' }, update: {},
    create: { firstName: 'Maria', lastName: 'Santos', email: 'maria@example.com', phone: '0918 765 4321', passwordHash, createdAt: d('2026-02-14') },
  });
  if (await db.unit.count({ where: { customerId: juan.id } })) return console.log('Demo customers already loaded, skipped.');

  const product = (slug: string) => db.product.findUniqueOrThrow({ where: { slug } });
  const [w2, vp] = await Promise.all([product('w2-170p'), product('vp-cu-200')]);
  const makati = await db.address.create({ data: { customerId: juan.id, label: 'Condo', line1: 'Unit 12B, Sample Tower', city: 'Makati City', province: 'Metro Manila', isDefault: true } });
  const binan = await db.address.create({ data: { customerId: juan.id, label: 'Home', line1: 'Sample Street', city: 'Biñan', province: 'Laguna' } });

  const order = await db.order.create({
    data: {
      orderNumber: 'HIQ-DEMO-1042', customerId: juan.id, contactName: 'Juan dela Cruz', contactEmail: juan.email, contactPhone: juan.phone,
      shipLine1: makati.line1, shipCity: makati.city, shipProvince: makati.province, status: 'delivered', subtotalCentavos: 0, totalCentavos: 0,
      requiresQuote: true, paymentMethod: 'gcash', createdAt: d('2026-03-01'),
      lines: { create: [{ productId: w2.id, name: w2.model, qty: 1, withInstallation: true }] },
    },
  });
  const u1 = await db.unit.create({
    data: { customerId: juan.id, productId: w2.id, addressId: makati.id, orderId: order.id, installedAt: d('2026-03-14'), nextFilterDueAt: d('2026-11-10'),
      serviceHistory: { create: [{ serviceDate: d('2026-03-14'), serviceType: 'installation', notes: 'Installation' }, { serviceDate: d('2026-08-02'), serviceType: 'maintenance', notes: 'Maintenance visit' }] },
      reminders: { create: { dueAt: d('2026-11-10') } } },
  });
  const u2 = await db.unit.create({
    data: { customerId: juan.id, productId: vp.id, addressId: binan.id, installedAt: d('2025-12-01'), nextFilterDueAt: d('2026-10-20'),
      serviceHistory: { create: { serviceDate: d('2025-12-01'), serviceType: 'installation', notes: 'Installation' } },
      reminders: { create: { dueAt: d('2026-10-20') } } },
  });
  await db.serviceBooking.create({
    data: { customerId: juan.id, unitId: u2.id, addressId: binan.id, contactName: 'Juan dela Cruz', contactPhone: juan.phone, contactEmail: juan.email,
      visitAddress: 'Sample Street, Biñan, Laguna', service: 'filter-replacement', preferredDate: d('2026-10-21'), preferredSlot: 'morning' },
  });
  console.log(`Demo customers: juan@example.com and maria@example.com (password demo1234); Juan has units ${u1.id.slice(0, 8)}… and ${u2.id.slice(0, 8)}…`);
}

try {
  await seedCatalog();
  await seedAdmin();
  await seedDemo();
} finally {
  await db.$disconnect();
}
