import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) firstName: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) lastName: string;
  @Transform(trim) @IsEmail({}, { message: 'Enter an email like name@example.com.' }) @MaxLength(160) email: string;
  @IsString() @Matches(/^(?:\D*\d){10,15}\D*$/, { message: 'Enter a mobile number with 10 to 15 digits.' }) phone: string;
  @IsString() @MinLength(8, { message: 'Use at least 8 characters.' }) @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)/, { message: 'Use a letter and a number in your password.' })
  password: string;
  @IsOptional() @IsBoolean() marketingOptIn?: boolean;
}

export class LoginDto {
  @Transform(trim) @IsEmail() email: string;
  @IsString() @IsNotEmpty() @MaxLength(128) password: string;
  @IsOptional() @IsBoolean() remember?: boolean;
}

export class OtpRequestDto {
  /** Email address or mobile number. */
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(160) destination: string;
}

export class OtpVerifyDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(160) destination: string;
  @IsString() @Length(6, 6) @Matches(/^\d{6}$/) code: string;
}

export class AdminLoginDto {
  @Transform(trim) @IsEmail() email: string;
  @IsString() @IsNotEmpty() @MaxLength(128) password: string;
}
