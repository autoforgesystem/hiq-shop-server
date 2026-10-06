import { Module } from '@nestjs/common';
import { AdminOrdersController, OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({ controllers: [OrdersController, AdminOrdersController], providers: [OrdersService], exports: [OrdersService] })
export class OrdersModule {}
