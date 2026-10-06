import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { ServiceModule } from '../service/service.module.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';

@Module({ imports: [OrdersModule, ServiceModule], controllers: [MeController], providers: [MeService] })
export class MeModule {}
