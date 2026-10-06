import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/auth.guards.js';
import { CreateLeadDto, ServiceAreaDto, UpdateLeadDto } from './leads.dto.js';
import { LeadsService } from './leads.service.js';

@ApiTags('leads')
@Controller()
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  /** Quote, rental, contact, business and newsletter forms. */
  @Post('leads') @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(@Body() dto: CreateLeadDto) {
    return this.leads.create(dto);
  }

  @Post('service-area/check') @HttpCode(200)
  check(@Body() dto: ServiceAreaDto) {
    return this.leads.checkServiceArea(dto);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/leads')
export class AdminLeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get() @ApiQuery({ name: 'type', required: false }) @ApiQuery({ name: 'status', required: false })
  list(@Query('type') type?: string, @Query('status') status?: string) {
    return this.leads.list(type, status);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.leads.update(id, dto);
  }
}
