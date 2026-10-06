import { Module } from '@nestjs/common';
import { AdminLeadsController, LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

@Module({ controllers: [LeadsController, AdminLeadsController], providers: [LeadsService] })
export class LeadsModule {}
