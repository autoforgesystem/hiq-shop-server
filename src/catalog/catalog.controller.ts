import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { diskStorage } from 'multer';
import { AdminGuard, AdminId, Roles } from '../auth/auth.guards.js';
import type { Env } from '../config/env.js';
import { CatalogImportDto, FilterDto, PhotoDto, ProductDto, ProductQueryDto } from './catalog.dto.js';
import { CatalogService } from './catalog.service.js';

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
const uploadDir = process.env.UPLOAD_DIR || 'uploads';

/** Checks the file's first bytes, so a renamed non-image can't pass as one just by its declared type. */
async function looksLikeImage(path: string, mimetype: string) {
  const fh = await open(path, 'r');
  try {
    const b = Buffer.alloc(12);
    await fh.read(b, 0, 12, 0);
    const ascii = (from: number, to: number) => b.toString('latin1', from, to);
    if (mimetype === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (mimetype === 'image/png') return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimetype === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    if (mimetype === 'image/avif') return ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12));
    return false;
  } finally {
    await fh.close();
  }
}

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Products, filters and site photos in one call (same shape as the front-end's CatalogData). */
  @Get('catalog')
  catalogData() {
    return this.catalog.publicCatalog();
  }

  @Get('products')
  products(@Query() q: ProductQueryDto) {
    return this.catalog.listProducts(q);
  }

  @Get('products/:slug')
  product(@Param('slug') slug: string) {
    return this.catalog.getProduct(slug);
  }

  /** Replacement filters, optionally for one model: /filters?model=w2-170p */
  @Get('filters')
  filters(@Query('model') model?: string) {
    return this.catalog.filtersFor(model);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminCatalogController {
  constructor(private readonly catalog: CatalogService, private readonly config: ConfigService<Env, true>) {}

  /** Full catalogue including hidden products. */
  @Get('catalog')
  all() {
    return this.catalog.adminCatalog();
  }

  /** Replaces the whole catalogue (the admin's "load a backup"). */
  @Put('catalog')
  import(@AdminId() admin: string, @Body() dto: CatalogImportDto) {
    return this.catalog.importCatalog(admin, dto);
  }

  /** Restores the catalogue that ships with the site. */
  @Post('catalog/reset') @HttpCode(200) @Roles('owner')
  reset(@AdminId() admin: string) {
    return this.catalog.resetCatalog(admin);
  }

  @Post('products')
  createProduct(@AdminId() admin: string, @Body() dto: ProductDto) {
    return this.catalog.createProduct(admin, dto);
  }

  @Put('products/:slug')
  updateProduct(@AdminId() admin: string, @Param('slug') slug: string, @Body() dto: ProductDto) {
    return this.catalog.updateProduct(admin, slug, dto);
  }

  @Delete('products/:slug') @HttpCode(204)
  deleteProduct(@AdminId() admin: string, @Param('slug') slug: string) {
    return this.catalog.deleteProduct(admin, slug);
  }

  @Post('filters')
  createFilter(@AdminId() admin: string, @Body() dto: FilterDto) {
    return this.catalog.createFilter(admin, dto);
  }

  @Put('filters/:id')
  updateFilter(@AdminId() admin: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FilterDto) {
    return this.catalog.updateFilter(admin, id, dto);
  }

  @Delete('filters/:id') @HttpCode(204)
  deleteFilter(@AdminId() admin: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteFilter(admin, id);
  }

  @Put('photos/:key')
  savePhoto(@AdminId() admin: string, @Param('key') key: string, @Body() dto: PhotoDto) {
    return this.catalog.savePhoto(admin, key, dto);
  }

  /** Puts a site photo back to its placeholder. */
  @Delete('photos/:key') @HttpCode(204)
  resetPhoto(@AdminId() admin: string, @Param('key') key: string) {
    return this.catalog.resetPhoto(admin, key);
  }

  /** Stores an image and returns its URL, to save on a product or photo slot. Max 5 MB; JPEG, PNG, WebP or AVIF. */
  @Post('uploads')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(IMAGE_TYPES[file.mimetype] ? null : new BadRequestException('Upload a JPEG, PNG, WebP or AVIF image.'), !!IMAGE_TYPES[file.mimetype]),
    storage: diskStorage({
      destination: (_req, _file, cb) => { mkdirSync(uploadDir, { recursive: true }); cb(null, uploadDir); },
      filename: (_req, file, cb) => cb(null, `${randomUUID()}.${IMAGE_TYPES[file.mimetype]}`),
    }),
  }))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attach an image in the "file" field.');
    if (!(await looksLikeImage(file.path, file.mimetype))) {
      await unlink(file.path).catch(() => undefined);
      throw new BadRequestException("That file isn't a valid JPEG, PNG, WebP or AVIF image.");
    }
    return { url: `${this.config.get('PUBLIC_URL', { infer: true })}/uploads/${file.filename}` };
  }
}
