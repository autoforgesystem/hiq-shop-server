import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { isoDate, todayUtc } from '../common/util.js';

/** Sends filter-replacement reminders 30 and 7 days before a unit's filters are due. */
@Injectable()
export class RemindersService {
  private readonly log = new Logger('Reminders');

  constructor(private readonly db: PrismaService, private readonly notify: NotificationsService) {}

  @Cron('0 9 * * *', { name: 'filter-reminders', timeZone: 'Asia/Manila' })
  async daily() {
    const r = await this.run();
    this.log.log(`Filter reminders sent: ${r.sent30} at 30 days, ${r.sent7} at 7 days`);
  }

  async run(today = todayUtc()) {
    const inDays = (n: number) => new Date(today.getTime() + n * 86_400_000);
    const send = async (field: 'sent30dAt' | 'sent7dAt', days: number) => {
      const due = await this.db.filterReminder.findMany({
        where: { completedAt: null, [field]: null, dueAt: { lte: inDays(days) } },
        include: { unit: { include: { product: true, customer: true } } },
      });
      for (const r of due) {
        const c = r.unit.customer;
        const text = `Hi ${c.firstName}, the filters on your ${r.unit.product.model} are due on ${isoDate(r.dueAt)}. Order filters or book a replacement visit at HIQ Shop.`;
        await this.notify.sms(c.phone, text);
        await this.notify.email(c.email, 'Your HIQ filters are due soon', text);
        // Sending the 7-day reminder also covers the 30-day one, so a late unit never gets two messages at once.
        await this.db.filterReminder.update({ where: { id: r.id }, data: field === 'sent7dAt' ? { sent7dAt: new Date(), sent30dAt: r.sent30dAt ?? new Date() } : { sent30dAt: new Date() } });
      }
      return due.length;
    };
    const sent7 = await send('sent7dAt', 7);
    const sent30 = await send('sent30dAt', 30);
    return { sent30, sent7 };
  }
}
