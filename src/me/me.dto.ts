import { Transform } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateProfileDto {
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) firstName?: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) lastName?: string;
  @IsOptional() @IsString() @Matches(/^(?:\D*\d){10,15}\D*$/, { message: 'Enter a mobile number with 10 to 15 digits.' }) phone?: string;
  @IsOptional() @IsBoolean() marketingOptIn?: boolean;
}

export class ChangePasswordDto {
  /** Leave out if the account has no password yet (signed up with a one-time code). */
  @IsOptional() @IsString() currentPassword?: string;
  @IsString() @MinLength(8) @MaxLength(128) @Matches(/^(?=.*[A-Za-z])(?=.*\d)/, { message: 'Use a letter and a number in your password.' }) newPassword: string;
}

export class AddressDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) label?: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) line1: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) line2?: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) city: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) province: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(12) postal?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class CreateSubscriptionDto {
  @IsUUID() unitId: string;
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) filterSkuIds: string[];
  /** Defaults to the shortest replacement interval of the chosen filters. */
  @IsOptional() @IsInt() @Min(1) @Max(36) intervalMonths?: number;
}
