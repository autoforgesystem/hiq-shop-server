import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service.js';
import { RemindersService } from './reminders.service.js';
import { AdminServiceController, ServiceController } from './service.controller.js';
import { UnitsService } from './units.service.js';

@Module({
  controllers: [ServiceController, AdminServiceController],
  providers: [UnitsService, BookingsService, RemindersService],
  exports: [UnitsService, BookingsService, RemindersService],
})
export class ServiceModule {}
