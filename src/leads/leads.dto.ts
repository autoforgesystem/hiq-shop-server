import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { LEAD_STATUSES, LEAD_TYPES } from '../common/constants.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/** Quote, rental, contact, business and newsletter forms. Needs an email or a phone number. */
export class CreateLeadDto {
  @IsIn(LEAD_TYPES) type: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) name?: string;
  @ValidateIf((l: CreateLeadDto) => l.type === 'newsletter' || !l.phone) @Transform(trim) @IsEmail({}, { message: 'Enter an email like name@example.com, or a mobile number.' }) email?: string;
  @ValidateIf((l: CreateLeadDto) => l.type !== 'newsletter' && !l.email) @Transform(trim) @IsString() @IsNotEmpty({ message: 'Enter a mobile number or an email.' })
  @Matches(/^(?:\D*\d){10,15}\D*$/, { message: 'Enter a mobile number with 10 to 15 digits.' }) phone?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) company?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(5000) message?: string;
  @IsOptional() @IsString() @MaxLength(80) productSlug?: string;
  /** Any other form fields, e.g. { "Number of staff": "20" }. */
  @IsOptional() @IsObject() details?: Record<string, string>;
  @IsOptional() @IsString() @MaxLength(120) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(120) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(120) utmCampaign?: string;
  /** Honeypot: real visitors never fill this hidden field. */
  @IsOptional() @IsString() website?: string;
}

export class UpdateLeadDto {
  @IsIn(LEAD_STATUSES) status: string;
}

export class ServiceAreaDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) city: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) province?: string;
}
