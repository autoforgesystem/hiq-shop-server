import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import bcrypt from 'bcryptjs';
import { readdirSync } from 'node:fs';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { CatalogService } from '../src/catalog/catalog.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('HIQ Shop API (e2e)', () => {
  let app: NestExpressApplication;
  let http: Parameters<typeof request>[0];
  let db: PrismaService;
  let notify: NotificationsService;
  let adminToken: string;
  let customerToken: string;
  let otherToken: string;

  const api = () => request(http);
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication<NestExpressApplication>({ logger: ['error'] }));
    await app.init();
    http = app.getHttpServer();
    db = app.get(PrismaService);
    notify = app.get(NotificationsService);
    await app.get(CatalogService).resetCatalog(undefined as unknown as string);
    await db.adminUser.create({ data: { email: 'owner@example.com', name: 'Owner', role: 'owner', passwordHash: await bcrypt.hash('owner-password-1', 4) } });
    await db.adminUser.create({ data: { email: 'editor@example.com', name: 'Editor', role: 'editor', passwordHash: await bcrypt.hash('editor-password-1', 4) } });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('health and catalogue', () => {
    it('reports healthy', async () => {
      await api().get('/api/health').expect(200, { status: 'ok' });
    });

    it('serves the catalogue in the front-end shape', async () => {
      const { body } = await api().get('/api/catalog').expect(200);
      expect(body.products).toHaveLength(16);
      expect(body.filters).toHaveLength(20);
      expect(body.parts).toHaveLength(31);
      const p = body.products.find((x: { slug: string }) => x.slug === 'hw-np-200');
      expect(p).toMatchObject({ model: 'HW NP 200', category: 'under-sink', channel: 'shop', needs: ['home', 'condo'], filtration: ['UF', 'Nano'], tdsLimit: 190, price: null, warrantyTbc: true });
      expect(p.specs).toMatchObject({ 'Inlet water requirement': 'Below 190 ppm TDS', Capacity: null });
    });

    it('filters products and finds one by slug with its replacement filters', async () => {
      const { body: under } = await api().get('/api/products?category=under-sink').expect(200);
      expect(under.every((p: { category: string }) => p.category === 'under-sink')).toBe(true);
      const { body: vp } = await api().get('/api/products/vp-cu-200').expect(200);
      expect(vp.filters.length).toBe(5);
      await api().get('/api/products/does-not-exist').expect(404);
      await api().get('/api/products?category=spaceship').expect(400);
    });

    it('lists spare parts by category and finds one by slug', async () => {
      const { body: fittings } = await api().get('/api/parts?category=fittings').expect(200);
      expect(fittings.length).toBeGreaterThan(0);
      expect(fittings.every((p: { category: string }) => p.category === 'fittings')).toBe(true);
      const { body: tubing } = await api().get('/api/parts/pe-tubing-1-4').expect(200);
      expect(tubing).toMatchObject({ sku: '[PART SKU TBC]', category: 'hoses-tubing', unit: 'meter', price: null, compatibleModels: [], images: [] });
      expect(Object.keys(tubing.specs)).toEqual(['Outside diameter', 'Colour', 'Food grade']); // label order is kept
      await api().get('/api/parts/does-not-exist').expect(404);
      await api().get('/api/parts?category=spaceship').expect(400);
    });
  });

  describe('customer sign-up and sign-in', () => {
    it('registers, rejects a duplicate email and never returns the password hash', async () => {
      const { body } = await api().post('/api/auth/register')
        .send({ firstName: ' Ana ', lastName: 'Reyes', email: 'Ana@Example.com', phone: '0917 555 0000', password: 'secret123' }).expect(201);
      expect(body.token).toBeTruthy();
      expect(body.customer).toMatchObject({ firstName: 'Ana', email: 'ana@example.com', name: 'Ana Reyes' });
      expect(JSON.stringify(body)).not.toContain('passwordHash');
      customerToken = body.token;
      const dup = await api().post('/api/auth/register').send({ firstName: 'A', lastName: 'B', email: 'ana@example.com', phone: '09175550000', password: 'secret123' }).expect(409);
      expect(dup.body.message).toMatch(/already exists/);
    });

    it('validates registration input', async () => {
      const { body } = await api().post('/api/auth/register').send({ firstName: '', lastName: 'X', email: 'nope', phone: '123', password: 'short' }).expect(400);
      expect(body.message.join(' ')).toMatch(/email|mobile|8 characters/);
    });

    it('signs in with the right password only', async () => {
      await api().post('/api/auth/login').send({ email: 'ana@example.com', password: 'wrong-pass1' }).expect(401);
      await api().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'secret123' }).expect(401);
      const { body } = await api().post('/api/auth/login').send({ email: 'ANA@example.com', password: 'secret123', remember: false }).expect(200);
      const me = await api().get('/api/auth/me').set(auth(body.token)).expect(200);
      expect(me.body.email).toBe('ana@example.com');
    });

    it('rejects missing and forged tokens', async () => {
      await api().get('/api/me').expect(401);
      await api().get('/api/me').set(auth('not.a.token')).expect(401);
    });

    it('signs in with a one-time code sent by SMS, matching +63 and 0 formats', async () => {
      const sms = vi.spyOn(notify, 'sms');
      await api().post('/api/auth/otp').send({ destination: '+63 917 555 0000' }).expect(202);
      const code = /(\d{6})/.exec(sms.mock.calls.at(-1)![1])![1];
      await api().post('/api/auth/verify').send({ destination: '09175550000', code: code === '000000' ? '111111' : '000000' }).expect(401);
      const { body } = await api().post('/api/auth/verify').send({ destination: '0917-555-0000', code }).expect(200);
      expect(body.customer.email).toBe('ana@example.com');
      await api().post('/api/auth/verify').send({ destination: '09175550000', code }).expect(401); // single use
    });

    it('answers the same for unknown accounts and sends nothing', async () => {
      const email = vi.spyOn(notify, 'email');
      email.mockClear();
      const { body } = await api().post('/api/auth/otp').send({ destination: 'ghost@example.com' }).expect(202);
      expect(body.sent).toBe(true);
      expect(email).not.toHaveBeenCalled();
    });
  });

  describe('admin', () => {
    it('signs in admins and keeps customers out', async () => {
      await api().post('/api/admin/auth/login').send({ email: 'owner@example.com', password: 'nope-nope-1' }).expect(401);
      const { body } = await api().post('/api/admin/auth/login').send({ email: 'owner@example.com', password: 'owner-password-1' }).expect(200);
      adminToken = body.token;
      expect(body.admin.role).toBe('owner');
      await api().get('/api/admin/catalog').set(auth(customerToken)).expect(401);
      await api().get('/api/catalog').set(auth(adminToken)).expect(200);
    });

    it('enforces owner-only actions', async () => {
      const { body } = await api().post('/api/admin/auth/login').send({ email: 'editor@example.com', password: 'editor-password-1' }).expect(200);
      await api().post('/api/admin/catalog/reset').set(auth(body.token)).expect(403);
      await api().get('/api/admin/audit-log').set(auth(body.token)).expect(403);
    });

    it('sets a price, hides and restores a product, and logs the change', async () => {
      const { body: cat } = await api().get('/api/admin/catalog').set(auth(adminToken)).expect(200);
      const p = cat.products.find((x: { slug: string }) => x.slug === 'w2-170p');
      const { body: saved } = await api().put('/api/admin/products/w2-170p').set(auth(adminToken)).send({ ...p, price: 24999.5, warrantyMonths: 12 }).expect(200);
      expect(saved).toMatchObject({ price: 24999.5, warrantyMonths: 12 });
      await api().put('/api/admin/products/w2-170p').set(auth(adminToken)).send({ ...p, slug: 'renamed' }).expect(409);

      await api().put('/api/admin/products/hw-110').set(auth(adminToken)).send({ ...cat.products.find((x: { slug: string }) => x.slug === 'hw-110'), hidden: true }).expect(200);
      await api().get('/api/products/hw-110').expect(404);
      const { body: pub } = await api().get('/api/catalog').expect(200);
      expect(pub.products.some((x: { slug: string }) => x.slug === 'hw-110')).toBe(false);

      const { body: log } = await api().get('/api/admin/audit-log').set(auth(adminToken)).expect(200);
      expect(log[0]).toMatchObject({ entity: 'products', entityId: 'hw-110', action: 'update' });
    });

    it('accepts real images only and serves them from /uploads', async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
      const { body } = await api().post('/api/admin/uploads').set(auth(adminToken)).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(201);
      const path = new URL(body.url).pathname;
      await api().get(path).expect(200).expect('Content-Type', /image\/png/);

      const before = readdirSync(process.env.UPLOAD_DIR!).length;
      const fake = await api().post('/api/admin/uploads').set(auth(adminToken)).attach('file', Buffer.from('not an image'), { filename: 'b.png', contentType: 'image/png' }).expect(400);
      expect(fake.body.message).toMatch(/isn't a valid/);
      expect(readdirSync(process.env.UPLOAD_DIR!).length).toBe(before); // the rejected file was removed
      await api().post('/api/admin/uploads').set(auth(adminToken)).attach('file', Buffer.from('hi'), { filename: 'c.txt', contentType: 'text/plain' }).expect(400);
      await api().post('/api/admin/uploads').attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(401);
    });

    it('creates and edits filters with intervals and prices', async () => {
      const { body: f } = await api().post('/api/admin/filters').set(auth(adminToken))
        .send({ sku: 'W2-SED-01', name: 'W2 sediment', stage: 'Stage 1', compatibleModels: ['w2-170p'], intervalMonths: 6, price: 850 }).expect(201);
      expect(f).toMatchObject({ sku: 'W2-SED-01', compatibleModels: ['w2-170p'], intervalMonths: 6, price: 850 });
      await api().post('/api/admin/filters').set(auth(adminToken)).send({ ...f, compatibleModels: ['nope'] }).expect(400);
      const { body: g } = await api().put(`/api/admin/filters/${f.id}`).set(auth(adminToken)).send({ ...f, price: 900 }).expect(200);
      expect(g.price).toBe(900);
    });

    it('creates, edits, hides and deletes spare parts', async () => {
      const part = {
        slug: 'w2-faucet-o-ring', sku: 'W2-OR-01', name: 'W2 faucet O-ring', category: 'other', description: 'Seal for the W2 faucet.',
        specs: { Size: '12 mm', Material: null }, images: [{ src: 'https://img.example.com/o-ring.webp', alt: 'O-ring' }],
        unit: 'piece', price: 45, compatibleModels: ['w2-170p'],
      };
      const { body: p } = await api().post('/api/admin/parts').set(auth(adminToken)).send(part).expect(201);
      expect(p).toMatchObject({ ...part, specs: { Size: '12 mm', Material: null } });
      await api().post('/api/admin/parts').set(auth(adminToken)).send(part).expect(409);
      await api().post('/api/admin/parts').set(auth(adminToken)).send({ ...part, slug: 'other-slug', compatibleModels: ['nope'] }).expect(400);
      await api().post('/api/admin/parts').set(auth(adminToken)).send({ ...part, slug: 'other-slug', unit: 'barrel' }).expect(400);
      await api().post('/api/admin/parts').send({ ...part, slug: 'other-slug' }).expect(401);

      const { body: forModel } = await api().get('/api/parts?model=w2-170p').expect(200);
      expect(forModel.map((x: { slug: string }) => x.slug)).toEqual(['w2-faucet-o-ring']);

      await api().put('/api/admin/parts/w2-faucet-o-ring').set(auth(adminToken)).send({ ...part, slug: 'renamed' }).expect(409);
      const { body: hidden } = await api().put('/api/admin/parts/w2-faucet-o-ring').set(auth(adminToken)).send({ ...part, price: 50, hidden: true }).expect(200);
      expect(hidden).toMatchObject({ price: 50, hidden: true });
      await api().get('/api/parts/w2-faucet-o-ring').expect(404);
      expect((await api().get('/api/admin/catalog').set(auth(adminToken))).body.parts.some((x: { slug: string }) => x.slug === 'w2-faucet-o-ring')).toBe(true);

      await api().delete('/api/admin/parts/w2-faucet-o-ring').set(auth(adminToken)).expect(204);
      await api().delete('/api/admin/parts/w2-faucet-o-ring').set(auth(adminToken)).expect(404);
      const { body: log } = await api().get('/api/admin/audit-log').set(auth(adminToken)).expect(200);
      expect(log[0]).toMatchObject({ entity: 'spare_parts', entityId: 'w2-faucet-o-ring', action: 'delete' });

      const tubing = (await api().get('/api/parts/pe-tubing-1-4')).body;
      await api().put('/api/admin/parts/pe-tubing-1-4').set(auth(adminToken)).send({ ...tubing, price: 35.5 }).expect(200);
    });
  });

  describe('checkout', () => {
    let orderNumber: string;

    it('prices orders on the server and ignores client prices', async () => {
      const { body } = await api().post('/api/orders').send({
        contact: { name: 'Guest Buyer', email: 'Guest@Example.com', phone: '0918 000 1111' },
        shipping: { line1: '1 Test St', city: 'Makati City', province: 'Metro Manila' },
        paymentMethod: 'gcash', install: { date: day(5), slot: 'morning' },
        lines: [{ productSlug: 'w2-170p', qty: 2, configuration: undefined, withInstallation: true, unitPrice: 1 }],
      }).expect(201);
      expect(body.id).toMatch(/^HIQ-[A-Z2-9]{6}$/);
      expect(body).toMatchObject({ subtotal: 49999, total: 49999, requiresQuote: false, deliveryFee: null, currency: 'PHP' });
      orderNumber = body.id;
    });

    it('flags TBC prices and rentals for a quote', async () => {
      const { body } = await api().post('/api/orders').set(auth(customerToken)).send({
        contact: { name: 'Ana Reyes', email: 'ana@example.com', phone: '09175550000' },
        shipping: { line1: '2 Test St', city: 'Biñan', province: 'Laguna' }, paymentMethod: 'card',
        lines: [{ productSlug: 'hw-np-200', qty: 1 }, { productSlug: 'w2-170p', qty: 1, mode: 'rent' }],
      }).expect(201);
      expect(body).toMatchObject({ subtotal: 0, requiresQuote: true });
      expect(body.lines.map((l: { unitPrice: number | null }) => l.unitPrice)).toEqual([null, null]);
      const mine = await api().get('/api/me/orders').set(auth(customerToken)).expect(200);
      expect(mine.body).toHaveLength(1);
    });

    it('refuses quote-only products, unknown configurations and past install dates', async () => {
      const base = { contact: { name: 'X', email: 'x@example.com', phone: '09170000000' }, shipping: { line1: 'a', city: 'b', province: 'c' }, paymentMethod: 'maya' };
      const quote = await api().post('/api/orders').send({ ...base, lines: [{ productSlug: 'hcro-300g', qty: 1 }] }).expect(400);
      expect(quote.body.message).toMatch(/quote only/);
      await api().post('/api/orders').send({ ...base, lines: [{ productSlug: 'w2-170p', qty: 1, configuration: 'Gold plated' }] }).expect(400);
      await api().post('/api/orders').send({ ...base, install: { date: day(-1) }, lines: [{ productSlug: 'w2-170p', qty: 1 }] }).expect(400);
      await api().post('/api/orders').send({ ...base, lines: [] }).expect(400);
    });

    it('sells spare parts by the unit, with larger quantities than systems', async () => {
      const base = { contact: { name: 'Reseller', email: 'reseller@example.com', phone: '09170000001' }, shipping: { line1: 'a', city: 'b', province: 'c' }, paymentMethod: 'gcash' };
      const { body } = await api().post('/api/orders').send({ ...base, lines: [{ sparePartSlug: 'pe-tubing-1-4', qty: 50 }, { sparePartSlug: 'elbow-connector-1-4', qty: 4 }] }).expect(201);
      expect(body).toMatchObject({ subtotal: 1775, requiresQuote: true }); // 50 m × ₱35.50; the elbow has no price yet
      const tubing = body.lines.find((l: { name: string }) => l.name === 'PE tubing, 1/4"');
      expect(tubing).toMatchObject({ qty: 50, unitPrice: 35.5, productId: null, filterSkuId: null });
      expect(tubing.sparePartId).toMatch(/^[0-9a-f-]{36}$/);

      await api().post('/api/orders').send({ ...base, lines: [{ sparePartSlug: 'nope', qty: 1 }] }).expect(400);
      await api().post('/api/orders').send({ ...base, lines: [{ sparePartSlug: 'pe-tubing-1-4', productSlug: 'w2-170p', qty: 1 }] }).expect(400);
      await api().post('/api/orders').send({ ...base, lines: [{ sparePartSlug: 'pe-tubing-1-4', qty: 501 }] }).expect(400);
      const many = await api().post('/api/orders').send({ ...base, lines: [{ productSlug: 'w2-170p', qty: 21 }] }).expect(400);
      expect(many.body.message).toMatch(/up to 20/);
    });

    it('shows an order to its guest only with the checkout email', async () => {
      await api().get(`/api/orders/${orderNumber}`).expect(404);
      await api().get(`/api/orders/${orderNumber}?email=someone@else.com`).expect(404);
      await api().get(`/api/orders/${orderNumber}`).set(auth(customerToken)).expect(404);
      const { body } = await api().get(`/api/orders/${orderNumber.toLowerCase()}?email=GUEST@example.com`).expect(200);
      expect(body.contact.name).toBe('Guest Buyer');
    });
  });

  describe('units, service and reminders', () => {
    let customerId: string;
    let addressId: string;
    let unitId: string;

    it('manages addresses with a single default', async () => {
      const a1 = await api().post('/api/me/addresses').set(auth(customerToken)).send({ line1: '2 Test St', city: 'Biñan', province: 'Laguna' }).expect(201);
      expect(a1.body.isDefault).toBe(true);
      const a2 = await api().post('/api/me/addresses').set(auth(customerToken)).send({ label: 'Office', line1: '9 Ayala', city: 'Makati City', province: 'Metro Manila', isDefault: true }).expect(201);
      const { body } = await api().get('/api/me/addresses').set(auth(customerToken)).expect(200);
      expect(body.filter((a: { isDefault: boolean }) => a.isDefault).map((a: { id: string }) => a.id)).toEqual([a2.body.id]);
      addressId = a1.body.id;
      customerId = (await api().get('/api/me').set(auth(customerToken))).body.id;
    });

    it('registers an installed unit and schedules filters from the shortest interval', async () => {
      const { body } = await api().post('/api/admin/units').set(auth(adminToken)).send({ customerId, productSlug: 'w2-170p', addressId, installedAt: '2026-01-15' }).expect(201);
      expect(body).toMatchObject({ model: 'W2-170P', installedAt: '2026-01-15', nextFilterDueAt: '2026-07-15', warranty: { endsAt: '2027-01-15', status: 'active' } });
      expect(body.serviceHistory[0].type).toBe('installation');
      unitId = body.id;
      const { body: units } = await api().get('/api/me/units').set(auth(customerToken)).expect(200);
      expect(units.map((u: { id: string }) => u.id)).toEqual([unitId]);
      const { body: due } = await api().get('/api/me/filters/due').set(auth(customerToken)).expect(200);
      expect(due.some((f: { filterSku: string; dueAt: string }) => f.filterSku === 'W2-SED-01' && f.dueAt === '2026-07-15')).toBe(true);
      await api().delete(`/api/me/addresses/${addressId}`).set(auth(customerToken)).expect(400);
    });

    it('takes a booking from the form, links the unit, and logs it when done', async () => {
      const { body } = await api().post('/api/bookings').set(auth(customerToken)).send({
        service: 'filter-replacement', unit: 'w2-170p', date: day(3), slot: 'afternoon', name: 'Ana Reyes', phone: '09175550000', address: '2 Test St', city: 'Biñan',
      }).expect(201);
      expect(body).toMatchObject({ unitId, status: 'requested', address: '2 Test St, Biñan' });
      const done = await api().patch(`/api/admin/bookings/${body.id}`).set(auth(adminToken)).send({ status: 'done', serviceDate: '2026-09-01', technicianName: 'Jun' }).expect(200);
      expect(done.body.status).toBe('done');
      const unit = (await api().get('/api/me/units').set(auth(customerToken))).body[0];
      expect(unit.nextFilterDueAt).toBe('2027-03-01');
      expect(unit.serviceHistory[0]).toMatchObject({ date: '2026-09-01', type: 'filter-replacement', technician: 'Jun' });
    });

    it('accepts guest bookings and protects other customers’ units', async () => {
      await api().post('/api/bookings').send({ service: 'water-test', unit: 'new', name: 'Walk In', phone: '09170001111', address: '5 Road', city: 'Pasig', date: day(4) }).expect(201);
      await api().post('/api/bookings').send({ service: 'maintenance', unitId, name: 'X', phone: '09170001111', address: 'a', city: 'b' }).expect(400);
      await api().post('/api/bookings').send({ service: 'water-test', name: 'Walk In', phone: '09170001111' }).expect(400);
      const other = await api().post('/api/auth/register').send({ firstName: 'Ben', lastName: 'Cruz', email: 'ben@example.com', phone: '09181112222', password: 'secret123' }).expect(201);
      otherToken = other.body.token;
      await api().post('/api/bookings').set(auth(otherToken)).send({ service: 'maintenance', unitId, name: 'Ben', phone: '09181112222', address: 'a', city: 'b' }).expect(404);
      await api().post('/api/warranty-claims').set(auth(otherToken)).send({ unitId, description: 'Leak' }).expect(404);
    });

    it('opens a warranty claim on an owned unit', async () => {
      const { body } = await api().post('/api/warranty-claims').set(auth(customerToken)).send({ unitId, description: 'Faucet drips' }).expect(201);
      expect(body.status).toBe('submitted');
      const { body: claims } = await api().get('/api/me/warranty-claims').set(auth(customerToken)).expect(200);
      expect(claims).toHaveLength(1);
    });

    it('sends each filter reminder once, at 30 and at 7 days', async () => {
      const sms = vi.spyOn(notify, 'sms');
      await db.filterReminder.updateMany({ where: { unitId, completedAt: null }, data: { dueAt: new Date(`${day(20)}T00:00:00Z`) } });
      sms.mockClear();
      const first = await api().post('/api/admin/reminders/run').set(auth(adminToken)).expect(200);
      expect(first.body.sent30).toBeGreaterThanOrEqual(1);
      expect(sms.mock.calls.some(([to]) => to === '0917 555 0000')).toBe(true);
      const again = await api().post('/api/admin/reminders/run').set(auth(adminToken)).expect(200);
      expect(again.body).toEqual({ sent30: 0, sent7: 0 });
    });

    it('keeps Subscribe & Save off until the offer is confirmed', async () => {
      const f = (await api().get('/api/filters?model=w2-170p')).body[0];
      await api().post('/api/me/subscriptions').set(auth(customerToken)).send({ unitId, filterSkuIds: [f.id] }).expect(403);
      expect((await api().get('/api/me/subscriptions').set(auth(customerToken)).expect(200)).body).toEqual([]);
      expect((await api().get('/api/me/loyalty').set(auth(customerToken)).expect(200)).body).toEqual({ points: 0, history: [] });
    });
  });

  describe('forms', () => {
    it('stores leads, needs a way to reply, and drops honeypot spam', async () => {
      const { body } = await api().post('/api/leads').send({ type: 'quote', name: 'Hotel Uno', phone: '0917 222 3333', productSlug: 'hcro-300g', details: { Rooms: '120' } }).expect(201);
      expect(body.id).toBeTruthy();
      await api().post('/api/leads').send({ type: 'contact', name: 'No contact' }).expect(400);
      await api().post('/api/leads').send({ type: 'newsletter', phone: '09170000000' }).expect(400);
      expect((await api().post('/api/leads').send({ type: 'contact', email: 'bot@example.com', website: 'spam' }).expect(201)).body).toEqual({ id: null });
      const { body: leads } = await api().get('/api/admin/leads?type=quote').set(auth(adminToken)).expect(200);
      expect(leads[0]).toMatchObject({ leadType: 'quote', product: { slug: 'hcro-300g' }, details: { Rooms: '120' } });
    });

    it('checks the service area against SERVICE_AREAS', async () => {
      expect((await api().post('/api/service-area/check').send({ city: 'makati city' }).expect(200)).body.covered).toBe(true);
      expect((await api().post('/api/service-area/check').send({ city: 'Biñan', province: 'Laguna' }).expect(200)).body.covered).toBe(true);
      expect((await api().post('/api/service-area/check').send({ city: 'Cebu City' }).expect(200)).body.covered).toBe(false);
    });
  });

  describe('catalogue import and reset', () => {
    it('hides products that units still use instead of deleting them, then resets', async () => {
      const { body: cat } = await api().get('/api/admin/catalog').set(auth(adminToken)).expect(200);
      const keep = cat.products.filter((p: { slug: string }) => p.slug !== 'w2-170p' && p.slug !== 'hw-np-100m');
      const r = await api().put('/api/admin/catalog').set(auth(adminToken)).send({ products: keep, filters: cat.filters.filter((f: { compatibleModels: string[] }) => !f.compatibleModels.includes('w2-170p') && !f.compatibleModels.includes('hw-np-100m')) }).expect(200);
      expect(r.body).toMatchObject({ products: 14, hidden: 1, parts: 31 }); // a backup without parts keeps the parts
      const after = (await api().get('/api/admin/catalog').set(auth(adminToken))).body.products.map((p: { slug: string }) => p.slug);
      expect(after).toContain('w2-170p');
      expect(after).not.toContain('hw-np-100m');

      const reset = await api().post('/api/admin/catalog/reset').set(auth(adminToken)).expect(200);
      expect(reset.body).toMatchObject({ products: 16, parts: 31 });
      expect((await api().get('/api/catalog')).body.products).toHaveLength(16);
    });
  });
});
