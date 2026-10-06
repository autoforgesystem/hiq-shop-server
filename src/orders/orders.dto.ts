import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max,
  MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { LINE_MODES, ORDER_STATUSES, PAYMENT_METHODS, SLOTS } from '../common/constants.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ContactDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(160) name: string;
  @Transform(trim) @IsEmail() @MaxLength(160) email: string;
  @IsString() @Matches(/^(?:\D*\d){10,15}\D*$/, { message: 'Enter a mobile number with 10 to 15 digits.' }) phone: string;
}

export class ShippingDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) line1: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) city: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) province: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(12) postal?: string;
}

export class InstallDto {
  @IsOptional() @IsDateString({ strict: true }) date?: string;
  @IsOptional() @IsIn(SLOTS) slot?: string;
}

/** One cart line: a product (by slug) or a replacement filter (by id). Prices are worked out on the server. */
export class OrderLineDto {
  @ValidateIf((l: OrderLineDto) => !l.filterSkuId) @IsString() @IsNotEmpty() productSlug?: string;
  @ValidateIf((l: OrderLineDto) => !l.productSlug) @IsUUID() filterSkuId?: string;
  @IsInt() @Min(1) @Max(20) qty: number;
  @IsOptional() @IsIn(LINE_MODES) mode?: string;
  @IsOptional() @IsString() @MaxLength(80) configuration?: string;
  @IsOptional() @IsBoolean() withInstallation?: boolean;
}

export class CreateOrderDto {
  @ValidateNested() @Type(() => ContactDto) contact: ContactDto;
  @ValidateNested() @Type(() => ShippingDto) shipping: ShippingDto;
  @IsIn(PAYMENT_METHODS) paymentMethod: string;
  @IsOptional() @ValidateNested() @Type(() => InstallDto) install?: InstallDto;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => OrderLineDto) lines: OrderLineDto[];
}

export class UpdateOrderStatusDto {
  @IsIn(ORDER_STATUSES) status: string;
  @IsOptional() @IsString() @MaxLength(120) platformOrderRef?: string;
}
