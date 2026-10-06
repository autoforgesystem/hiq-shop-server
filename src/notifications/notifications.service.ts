import { Global, Injectable, Logger, Module } from '@nestjs/common';

/**
 * Sends email and SMS. No provider is connected yet, so messages are written to the server log.
 * Plug in an email service (e.g. SES, Postmark) and an SMS gateway (e.g. Semaphore) here.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  async email(to: string, subject: string, body: string) {
    this.log.log(`EMAIL to ${to} | ${subject} | ${body}`);
  }

  async sms(to: string, body: string) {
    this.log.log(`SMS to ${to} | ${body}`);
  }
}

@Global()
@Module({ providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
