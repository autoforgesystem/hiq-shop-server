import { Transform } from 'class-transformer';
import { IsDateString, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { BOOKING_STATUSES, CLAIM_STATUSES, SERVICES, SLOTS, WARRANTY_STATUSES } from '../common/constants.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Matches the /service/book form in the front-end. */
export class CreateBookingDto {
  @IsIn(SERVICES) service: string;
  /** A unit from the customer's account (signed-in only). */
  @IsOptional() @IsUUID() unitId?: string;
  /** What the form sends today: a product slug, or "new" for a new installation. */
  @IsOptional() @IsString() @MaxLength(80) unit?: string;
  /** A saved address (signed-in only). Otherwise send address + city. */
  @IsOptional() @IsUUID() addressId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) address?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(160) name: string;
  @IsString() @Matches(/^(?:\D*\d){10,15}\D*$/, { message: 'Enter a mobile number with 10 to 15 digits.' }) phone: string;
  @IsOptional() @Transform(({ value }) => (value === '' ? undefined : value)) @IsEmail() email?: string;
  @IsOptional() @IsDateString({ strict: true }) date?: string;
  @IsOptional() @IsIn(SLOTS) slot?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateBookingDto {
  @IsIn(BOOKING_STATUSES) status: string;
  /** When marking done: who did the visit, what they did, and the visit date (defaults to today). */
  @IsOptional() @IsString() @MaxLength(120) technicianName?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsDateString({ strict: true }) serviceDate?: string;
}

export class CreateUnitDto {
  @IsUUID() customerId: string;
  @IsString() @IsNotEmpty() productSlug: string;
  @IsUUID() addressId: string;
  @IsOptional() @IsString() orderNumber?: string;
  @IsOptional() @IsString() @MaxLength(80) configuration?: string;
  @IsOptional() @IsString() @MaxLength(80) serialNumber?: string;
  @IsDateString({ strict: true }) installedAt: string;
  /** Defaults to installedAt + the product's warranty months, when known. */
  @IsOptional() @IsDateString({ strict: true }) warrantyEndsAt?: string;
}

export class UpdateUnitDto {
  @IsOptional() @IsDateString({ strict: true }) nextFilterDueAt?: string;
  @IsOptional() @IsDateString({ strict: true }) warrantyEndsAt?: string;
  @IsOptional() @IsIn(WARRANTY_STATUSES) warrantyStatus?: string;
  @IsOptional() @IsString() @MaxLength(80) serialNumber?: string;
}

export class ServiceRecordDto {
  @IsDateString({ strict: true }) serviceDate: string;
  @IsIn(SERVICES) serviceType: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsString() @MaxLength(120) technicianName?: string;
}

export class CreateClaimDto {
  @IsUUID() unitId: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(2000) description: string;
}

export class UpdateClaimDto {
  @IsIn(CLAIM_STATUSES) status: string;
}
