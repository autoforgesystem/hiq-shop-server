import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min,
  ValidateNested, registerDecorator, type ValidationOptions,
} from 'class-validator';
import { CATEGORIES, CHANNELS, FILTRATION_CODES, NEED_CODES } from '../common/constants.js';

/** Specs are a flat map of label → value, where null means [TBC]. */
function IsSpecMap(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isSpecMap', target: object.constructor, propertyName, options: { message: 'specs must map labels to text or null', ...options },
      validator: {
        validate: (v: unknown) =>
          !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 50 &&
          Object.entries(v).every(([k, x]) => k.length <= 80 && (x === null || (typeof x === 'string' && x.length <= 500))),
      },
    });
}

// Images can be URLs from /admin/uploads, or data URLs from the browser-only admin (kept for import).
export class ProductImageDto {
  @IsString() @IsNotEmpty() @MaxLength(8_000_000) src: string;
  @IsString() @MaxLength(300) alt: string;
}

/** Same shape as `Product` in apps/src/data/types.ts. Prices are in pesos. */
export class ProductDto {
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be lowercase letters, numbers and hyphens' }) @MaxLength(80) slug: string;
  @IsString() @IsNotEmpty() @MaxLength(120) model: string;
  @IsIn(CATEGORIES) category: string;
  @IsIn(CHANNELS) channel: string;
  @IsArray() @IsIn(NEED_CODES, { each: true }) needs: string[];
  @IsArray() @IsIn(FILTRATION_CODES, { each: true }) filtration: string[];
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true }) configurations: string[];
  @IsBoolean() hotCold: boolean;
  @IsString() @MaxLength(120) install: string;
  @IsOptional() @IsInt() @Min(0) tdsLimit?: number | null;
  @IsOptional() @IsBoolean() entry?: boolean;
  @IsOptional() @IsBoolean() bottleless?: boolean;
  @IsOptional() @IsBoolean() tableTop?: boolean;
  @IsOptional() @IsBoolean() office?: boolean;
  @IsString() @MaxLength(2000) summary: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(200, { each: true }) highlights: string[];
  @IsObject() @IsSpecMap() specs: Record<string, string | null>;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) price: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(600) warrantyMonths?: number | null;
  @IsOptional() @IsBoolean() warrantyTbc?: boolean;
  @IsOptional() @IsString() @MaxLength(500) storeUrl: string | null;
  @IsOptional() @IsInt() @Min(0) featured?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => ProductImageDto) images?: ProductImageDto[];
  @IsOptional() @IsBoolean() hidden?: boolean;
}

/** Same shape as `FilterSku` in apps/src/data/types.ts, without the id. */
export class FilterDto {
  @IsString() @IsNotEmpty() @MaxLength(80) sku: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name: string;
  @IsString() @IsNotEmpty() @MaxLength(160) stage: string;
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) compatibleModels: string[];
  @IsOptional() @IsInt() @Min(1) @Max(120) intervalMonths: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10_000_000) price: number | null;
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class ImportFilterDto extends FilterDto {
  /** Existing filter id to update; anything else (e.g. "f1" from the browser admin) creates a new filter. */
  @IsOptional() @IsString() id?: string;
}

export class PhotoDto {
  @IsOptional() @IsString() @MaxLength(8_000_000) src?: string | null;
  @IsString() @MaxLength(300) alt: string;
}

/** Same shape as `CatalogData` in apps/src/data/repository.ts. */
export class CatalogImportDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ProductDto) products: ProductDto[];
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => ImportFilterDto) filters: ImportFilterDto[];
  @IsOptional() @IsObject() photos?: Record<string, PhotoDto>;
}

export class ProductQueryDto {
  @IsOptional() @IsIn(CATEGORIES) category?: string;
  @IsOptional() @IsIn(NEED_CODES) need?: string;
  @IsOptional() @IsIn(CHANNELS) channel?: string;
}
