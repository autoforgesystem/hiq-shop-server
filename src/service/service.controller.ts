import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard, CustomerGuard, CustomerId, OptionalCustomerGuard } from '../auth/auth.guards.js';
import { BookingsService } from './bookings.service.js';
import { RemindersService } from './reminders.service.js';
import { CreateBookingDto, CreateClaimDto, CreateUnitDto, ServiceRecordDto, UpdateBookingDto, UpdateClaimDto, UpdateUnitDto } from './service.dto.js';
import { UnitsService } from './units.service.js';

@ApiTags('service')
@Controller()
export class ServiceController {
  constructor(private readonly bookings: BookingsService) {}

  /** Book installation, a water test, maintenance or filter replacement. Guests welcome. */
  @Post('bookings') @UseGuards(OptionalCustomerGuard) @ApiBearerAuth() @Throttle({ default: { limit: 10, ttl: 60_000 } })
  book(@Body() dto: CreateBookingDto, @CustomerId() customerId?: string) {
    return this.bookings.create(dto, customerId);
  }

  @Post('warranty-claims') @UseGuards(CustomerGuard) @ApiBearerAuth()
  claim(@CustomerId() customerId: string, @Body() dto: CreateClaimDto) {
    return this.bookings.createClaim(customerId, dto);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminServiceController {
  constructor(private readonly units: UnitsService, private readonly bookings: BookingsService, private readonly reminders: RemindersService) {}

  @Get('units') @ApiQuery({ name: 'customerId', required: false })
  listUnits(@Query('customerId') customerId?: string) {
    return this.units.adminList(customerId);
  }

  /** Register an installed unit on a customer's account. Starts the filter schedule. */
  @Post('units')
  createUnit(@Body() dto: CreateUnitDto) {
    return this.units.create(dto);
  }

  @Patch('units/:id')
  updateUnit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUnitDto) {
    return this.units.update(id, dto);
  }

  /** Log a visit that wasn't booked online. */
  @Post('units/:id/service-history')
  recordService(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ServiceRecordDto) {
    return this.units.recordService(id, dto);
  }

  @Get('bookings') @ApiQuery({ name: 'status', required: false })
  listBookings(@Query('status') status?: string) {
    return this.bookings.adminList(status);
  }

  @Patch('bookings/:id')
  updateBooking(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBookingDto) {
    return this.bookings.update(id, dto);
  }

  @Get('warranty-claims') @ApiQuery({ name: 'status', required: false })
  listClaims(@Query('status') status?: string) {
    return this.bookings.adminClaims(status);
  }

  @Patch('warranty-claims/:id')
  updateClaim(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClaimDto) {
    return this.bookings.updateClaim(id, dto);
  }

  /** Runs the daily filter-reminder job now (it also runs every day at 9:00 Manila time). */
  @Post('reminders/run') @HttpCode(200)
  runReminders() {
    return this.reminders.run();
  }
}
