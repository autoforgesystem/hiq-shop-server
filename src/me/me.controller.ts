import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service.js';
import { CustomerGuard, CustomerId } from '../auth/auth.guards.js';
import { OrdersService } from '../orders/orders.service.js';
import { BookingsService } from '../service/bookings.service.js';
import { UnitsService } from '../service/units.service.js';
import { AddressDto, ChangePasswordDto, CreateSubscriptionDto, UpdateProfileDto } from './me.dto.js';
import { MeService } from './me.service.js';

/** The signed-in customer's account (see apps/docs/API.md). */
@ApiTags('me')
@ApiBearerAuth()
@UseGuards(CustomerGuard)
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly auth: AuthService,
    private readonly units: UnitsService,
    private readonly orders: OrdersService,
    private readonly bookings: BookingsService,
  ) {}

  @Get()
  profile(@CustomerId() id: string) {
    return this.auth.me(id);
  }

  @Patch()
  updateProfile(@CustomerId() id: string, @Body() dto: UpdateProfileDto) {
    return this.me.updateProfile(id, dto);
  }

  @Post('password') @HttpCode(204)
  changePassword(@CustomerId() id: string, @Body() dto: ChangePasswordDto) {
    return this.me.changePassword(id, dto);
  }

  /** My Units: installed systems with filter due dates, warranty and service history. */
  @Get('units')
  myUnits(@CustomerId() id: string) {
    return this.units.forCustomer(id);
  }

  @Get('filters/due')
  filtersDue(@CustomerId() id: string) {
    return this.units.filtersDue(id);
  }

  @Get('orders')
  myOrders(@CustomerId() id: string) {
    return this.orders.forCustomer(id);
  }

  @Get('bookings')
  myBookings(@CustomerId() id: string) {
    return this.bookings.forCustomer(id);
  }

  @Get('warranty-claims')
  myClaims(@CustomerId() id: string) {
    return this.bookings.claimsFor(id);
  }

  @Get('addresses')
  addresses(@CustomerId() id: string) {
    return this.me.addresses(id);
  }

  @Post('addresses')
  addAddress(@CustomerId() id: string, @Body() dto: AddressDto) {
    return this.me.addAddress(id, dto);
  }

  @Put('addresses/:addressId')
  updateAddress(@CustomerId() id: string, @Param('addressId', ParseUUIDPipe) addressId: string, @Body() dto: AddressDto) {
    return this.me.updateAddress(id, addressId, dto);
  }

  @Delete('addresses/:addressId') @HttpCode(204)
  deleteAddress(@CustomerId() id: string, @Param('addressId', ParseUUIDPipe) addressId: string) {
    return this.me.deleteAddress(id, addressId);
  }

  @Get('subscriptions')
  subscriptions(@CustomerId() id: string) {
    return this.me.subscriptions(id);
  }

  /** Disabled until HIQ confirms the offer (SUBSCRIPTIONS_ENABLED=true). */
  @Post('subscriptions')
  subscribe(@CustomerId() id: string, @Body() dto: CreateSubscriptionDto) {
    return this.me.subscribe(id, dto);
  }

  @Delete('subscriptions/:subscriptionId') @HttpCode(204)
  cancel(@CustomerId() id: string, @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string) {
    return this.me.cancelSubscription(id, subscriptionId);
  }

  @Get('loyalty')
  loyalty(@CustomerId() id: string) {
    return this.me.loyalty(id);
  }
}
