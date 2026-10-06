import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard, CustomerId, OptionalCustomerGuard } from '../auth/auth.guards.js';
import { CreateOrderDto, UpdateOrderStatusDto } from './orders.dto.js';
import { OrdersService } from './orders.service.js';

@ApiTags('orders')
@Controller('orders')
@UseGuards(OptionalCustomerGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Checkout. Works for guests; signed-in customers get the order linked to their account. */
  @Post() @ApiBearerAuth() @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() dto: CreateOrderDto, @CustomerId() customerId?: string) {
    return this.orders.create(dto, customerId);
  }

  /** Order confirmation page. Guests pass the checkout email: /orders/HIQ-ABC123?email=... */
  @Get(':orderNumber') @ApiBearerAuth() @ApiQuery({ name: 'email', required: false })
  findOne(@Param('orderNumber') orderNumber: string, @CustomerId() customerId?: string, @Query('email') email?: string) {
    return this.orders.findOne(orderNumber, customerId, email);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get() @ApiQuery({ name: 'status', required: false })
  list(@Query('status') status?: string) {
    return this.orders.adminList(status);
  }

  @Patch(':orderNumber')
  update(@Param('orderNumber') orderNumber: string, @Body() dto: UpdateOrderStatusDto) {
    return this.orders.updateStatus(orderNumber, dto);
  }
}
