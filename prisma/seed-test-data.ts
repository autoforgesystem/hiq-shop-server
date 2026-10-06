/**
 * Test data for trying out the API and the admin: customers, addresses, installed units, orders, service
 * bookings, warranty claims, filter reminders and leads, in every status. Run after `npm run db:seed`.
 *
 *   npm run db:seed:test           add the test data (skipped if it's already there)
 *   npm run db:seed:test -- --fresh  delete the test data first, then add it again
 *
 * Every test customer's email ends in @test.example.com, so the data is easy to find and remove.
 * The same data is generated on every run (fixed random seed). Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client.js';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load test data into a production database.');

const DOMAIN = '@test.example.com';
const PASSWORD = 'Test1234';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: 1 }) });

// Small deterministic random generator, so every run creates the same data.
let state = 20261006;
const rand = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const DAY = 86_400_000;
const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
const daysFromToday = (n: number) => new Date(today.getTime() + n * DAY);
const addMonths = (d: Date, m: number) => { const r = new Date(d); r.setUTCMonth(r.getUTCMonth() + m); return r; };

const FIRST = ['Ana', 'Ben', 'Carla', 'Dante', 'Elena', 'Francis', 'Grace', 'Hector', 'Isabel', 'Jose', 'Karen', 'Leo', 'Mika', 'Noel', 'Olivia', 'Paolo', 'Queenie', 'Ramon', 'Sofia', 'Tomas', 'Ursula', 'Vince', 'Wilma', 'Xavier'];
const LAST = ['Reyes', 'Santos', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Torres', 'Flores', 'Villanueva', 'Ramos', 'Aquino', 'Castillo', 'Navarro', 'Domingo', 'Gonzales', 'Lim'];
const PLACES = [
  ['Makati City', 'Metro Manila', '1226'], ['Quezon City', 'Metro Manila', '1100'], ['Taguig', 'Metro Manila', '1634'], ['Pasig', 'Metro Manila', '1600'],
  ['Mandaluyong', 'Metro Manila', '1550'], ['Biñan', 'Laguna', '4024'], ['Santa Rosa', 'Laguna', '4026'], ['Bacoor', 'Cavite', '4102'],
  ['Antipolo', 'Rizal', '1870'], ['Cebu City', 'Cebu', '6000'], ['Davao City', 'Davao del Sur', '8000'], ['Iloilo City', 'Iloilo', '5000'],
] as const;
const STREETS = ['Mabini St', 'Rizal Ave', 'Bonifacio St', 'Luna St', 'Del Pilar St', 'Kalayaan Ave', 'Sampaguita St', 'Narra St'];
const ORDER_MIX = ['delivered', 'delivered', 'shipped', 'delivered', 'paid', 'pending', 'delivered', 'cancelled'] as const;
const ORDER_AGE: Record<(typeof ORDER_MIX)[number], [number, number]> = { delivered: [31, 200], shipped: [8, 30], paid: [2, 14], pending: [0, 3], cancelled: [5, 120] };
type Line = { productId?: string; filterSkuId?: string; name: string; qty: number; mode: string; withInstallation: boolean; configuration: string | null; unitPriceCentavos: number | null };
const phone = () => `09${int(15, 99)} ${int(100, 999)} ${int(1000, 9999)}`;

async function removeTestData() {
  const ends = { endsWith: DOMAIN };
  const customers = await db.customer.findMany({ where: { email: ends }, select: { id: true } });
  const ids = customers.map((c) => c.id);
  const r = {
    leads: (await db.lead.deleteMany({ where: { email: ends } })).count,
    bookings: (await db.serviceBooking.deleteMany({ where: { OR: [{ customerId: { in: ids } }, { contactEmail: ends }] } })).count,
    orders: (await db.order.deleteMany({ where: { OR: [{ customerId: { in: ids } }, { contactEmail: ends }] } })).count,
    // Cascades to addresses, units, service history, reminders and warranty claims.
    customers: (await db.customer.deleteMany({ where: { id: { in: ids } } })).count,
  };
  console.log(`Removed test data: ${r.customers} customers, ${r.orders} orders, ${r.bookings} bookings, ${r.leads} leads`);
}

async function main() {
  if (process.argv.includes('--fresh')) await removeTestData();
  if (await db.customer.count({ where: { email: { endsWith: DOMAIN } } })) {
    console.log('Test data is already loaded. Run with --fresh to recreate it.');
    return;
  }
  const products = await db.product.findMany({ where: { isHidden: false }, include: { configurations: { include: { configuration: true } } } });
  if (!products.length) throw new Error('No products found. Run `npm run db:seed` first.');
  const shop = products.filter((p) => p.channel === 'shop');
  const quote = products.filter((p) => p.channel === 'quote');
  const filters = await db.filterSku.findMany({ include: { compatibleWith: true } });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const counts = { customers: 0, addresses: 0, orders: 0, units: 0, bookings: 0, claims: 0, reminders: 0, leads: 0 };
  let orderSeq = 1;
  const orderNumber = () => `HIQ-T${String(orderSeq++).padStart(5, '0')}`;

  for (let i = 0; i < 24; i++) {
    const firstName = FIRST[i], lastName = pick(LAST);
    const joined = daysFromToday(-int(220, 500)); // before any of their orders
    const customer = await db.customer.create({
      data: {
        firstName, lastName, email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${DOMAIN}`, phone: phone(),
        passwordHash: i % 12 === 11 ? null : passwordHash, // a couple of one-time-code-only accounts
        marketingOptIn: chance(0.4), emailVerifiedAt: chance(0.7) ? joined : null, createdAt: joined,
      },
    });
    counts.customers++;

    const addresses = [];
    for (let a = 0; a < (chance(0.3) ? 2 : 1); a++) {
      const [city, province, postal] = pick(PLACES);
      addresses.push(await db.address.create({
        data: { customerId: customer.id, label: a === 0 ? pick(['Home', 'Condo']) : 'Office', line1: `${int(1, 250)} ${pick(STREETS)}`, line2: chance(0.3) ? `Unit ${int(1, 30)}${pick(['A', 'B', 'C'])}` : null, city, province, postal, isDefault: a === 0, createdAt: joined },
      }));
      counts.addresses++;
    }
    const home = addresses[0];

    // Orders: most customers have one or two, in every status.
    for (let o = 0; o < int(1, 2); o++) {
      // Status first (cycling, so every status appears), then an order date that fits it.
      const status = ORDER_MIX[counts.orders % ORDER_MIX.length];
      const [minAge, maxAge] = ORDER_AGE[status];
      const placed = daysFromToday(-int(minAge, maxAge));
      const product = pick(shop);
      const rent = chance(0.15);
      const withInstallation = !rent && chance(0.8);
      const lines: Line[] = [{
        productId: product.id, name: product.model, qty: 1, mode: rent ? 'rent' : 'buy', withInstallation,
        configuration: product.configurations[0]?.configuration.name ?? null, unitPriceCentavos: rent ? null : product.priceCentavos,
      }];
      const compatible = filters.filter((f) => f.compatibleWith.some((c) => c.productId === product.id));
      if (compatible.length && chance(0.4)) {
        const f = pick(compatible);
        lines.push({ filterSkuId: f.id, name: f.name, qty: int(1, 2), mode: 'buy', withInstallation: false, configuration: null, unitPriceCentavos: f.priceCentavos });
      }
      const subtotal = lines.reduce((s, l) => s + (l.unitPriceCentavos ?? 0) * l.qty, 0);
      const order = await db.order.create({
        data: {
          orderNumber: orderNumber(), customerId: customer.id, contactName: `${firstName} ${lastName}`, contactEmail: customer.email, contactPhone: customer.phone,
          shipLine1: home.line1, shipCity: home.city, shipProvince: home.province, shipPostal: home.postal, status,
          subtotalCentavos: subtotal, totalCentavos: subtotal, requiresQuote: lines.some((l) => l.unitPriceCentavos == null),
          paymentMethod: pick(['card', 'gcash', 'gcash', 'maya', 'online_banking']), platformOrderRef: status === 'pending' ? null : `PAY-${int(100000, 999999)}`,
          installPreferredDate: withInstallation ? new Date(placed.getTime() + int(3, 10) * DAY) : null, installPreferredSlot: withInstallation ? pick(['morning', 'afternoon']) : null,
          createdAt: placed, lines: { create: lines },
        },
      });
      counts.orders++;

      // Delivered orders with installation become units on the customer's account.
      if (status === 'delivered' && withInstallation) {
        const installedAt = new Date(placed.getTime() + int(3, 10) * DAY);
        const nextFilterDueAt = daysFromToday(pick([-12, -3, 4, 6, 18, 25, 40, 90, 150, 210]));
        const warrantyEndsAt = addMonths(installedAt, 12);
        const unit = await db.unit.create({
          data: {
            customerId: customer.id, productId: product.id, addressId: home.id, orderId: order.id, configuration: lines[0].configuration,
            serialNumber: `SN-${product.slug.toUpperCase()}-${int(10000, 99999)}`, installedAt, nextFilterDueAt, warrantyEndsAt,
            warrantyStatus: warrantyEndsAt < today ? 'expired' : 'active',
            serviceHistory: { create: [{ serviceDate: installedAt, serviceType: 'installation', notes: 'Installation', technicianName: pick(['Jun', 'Marco', 'Rey', 'Bong']) }] },
            createdAt: installedAt,
          },
        });
        counts.units++;
        const due = Math.round((nextFilterDueAt.getTime() - today.getTime()) / DAY);
        await db.filterReminder.create({ data: { unitId: unit.id, dueAt: nextFilterDueAt, sent30dAt: due <= 30 ? daysFromToday(Math.min(0, due - 30)) : null, sent7dAt: due <= 7 ? daysFromToday(Math.min(0, due - 7)) : null } });
        counts.reminders++;

        if (chance(0.5)) {
          const done = chance(0.6);
          const booking = await db.serviceBooking.create({
            data: {
              customerId: customer.id, unitId: unit.id, addressId: home.id, contactName: `${firstName} ${lastName}`, contactPhone: customer.phone, contactEmail: customer.email,
              visitAddress: `${home.line1}, ${home.city}`, service: pick(['maintenance', 'filter-replacement', 'troubleshooting']),
              preferredDate: done ? daysFromToday(-int(5, 60)) : daysFromToday(int(2, 21)), preferredSlot: pick(['morning', 'afternoon', 'late-afternoon']),
              status: done ? 'done' : pick(['requested', 'confirmed', 'cancelled']), notes: chance(0.4) ? 'Please call before arriving.' : null,
            },
          });
          counts.bookings++;
          if (done) await db.serviceHistory.create({ data: { unitId: unit.id, bookingId: booking.id, serviceDate: booking.preferredDate!, serviceType: booking.service, notes: 'Completed', technicianName: pick(['Jun', 'Marco', 'Rey', 'Bong']) } });
        }
        if (counts.units % 3 === 1) { // every third unit, cycling through the claim statuses
          await db.warrantyClaim.create({ data: { unitId: unit.id, description: pick(['Faucet drips after use', 'Unit makes a humming noise', 'Low water flow', 'Hot water not heating']), status: ['submitted', 'approved', 'resolved', 'rejected'][counts.claims % 4] } });
          counts.claims++;
        }
      }
    }
  }

  // Guest orders and bookings (no account).
  for (let g = 0; g < 6; g++) {
    const [city, province] = pick(PLACES);
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const email = `guest${g + 1}${DOMAIN}`;
    const product = pick(shop);
    await db.order.create({
      data: {
        orderNumber: orderNumber(), contactName: name, contactEmail: email, contactPhone: phone(), shipLine1: `${int(1, 250)} ${pick(STREETS)}`, shipCity: city, shipProvince: province,
        status: pick(['pending', 'paid', 'cancelled']), subtotalCentavos: product.priceCentavos ?? 0, totalCentavos: product.priceCentavos ?? 0, requiresQuote: product.priceCentavos == null,
        paymentMethod: pick(['card', 'gcash', 'maya']), createdAt: daysFromToday(-int(1, 30)),
        lines: { create: [{ productId: product.id, name: product.model, qty: 1, withInstallation: true }] },
      },
    });
    counts.orders++;
    await db.serviceBooking.create({
      data: {
        contactName: name, contactPhone: phone(), contactEmail: email, visitAddress: `${int(1, 250)} ${pick(STREETS)}, ${city}`,
        service: pick(['water-test', 'installation', 'general']), preferredDate: daysFromToday(int(1, 14)), preferredSlot: pick(['morning', 'afternoon']),
        status: pick(['requested', 'requested', 'confirmed']), notes: g % 2 ? 'New installation' : 'Deep well water, please test first.',
      },
    });
    counts.bookings++;
  }

  // Leads from the site's forms.
  const LEADS = [
    ['quote', 'Hotel bottling for 120 rooms'], ['quote', 'Commercial RO for a restaurant'], ['rental', 'Rent a dispenser for our office pantry'],
    ['contact', 'Do you service Cebu?'], ['business', 'Water stations for 3 branches'], ['newsletter', null], ['contact', 'Which filter fits my old unit?'],
  ] as const;
  for (let l = 0; l < 25; l++) {
    const [type, message] = LEADS[l % LEADS.length]; // cycle so every form type appears
    const product = type === 'quote' ? pick(quote) : type === 'rental' ? pick(shop) : null;
    const source = pick([['facebook', 'social', 'summer-water'], ['google', 'cpc', 'ro-systems'], ['newsletter', 'email', 'october'], [null, null, null]] as const);
    await db.lead.create({
      data: {
        leadType: type, name: type === 'newsletter' ? null : `${pick(FIRST)} ${pick(LAST)}`, email: `lead${l + 1}${DOMAIN}`, phone: type === 'newsletter' ? null : phone(),
        company: type === 'quote' || type === 'business' ? pick(['Hotel Uno', 'Bistro Manila', 'Coral Tree Offices', 'Sunrise Resort']) : null,
        message, productId: product?.id ?? null, details: type === 'quote' ? { Rooms: String(int(20, 200)) } : {},
        utmSource: source[0], utmMedium: source[1], utmCampaign: source[2], status: pick(['new', 'new', 'contacted', 'won', 'lost']), createdAt: daysFromToday(-int(0, 90)),
      },
    });
    counts.leads++;
  }

  console.log(`Test data: ${counts.customers} customers, ${counts.addresses} addresses, ${counts.orders} orders, ${counts.units} units, ${counts.reminders} filter reminders, ${counts.bookings} bookings, ${counts.claims} warranty claims, ${counts.leads} leads`);
  console.log(`Test customers sign in with <first>.<last>${DOMAIN} and the password ${PASSWORD} (two accounts are one-time-code only).`);
}

try {
  await main();
} finally {
  await db.$disconnect();
}
