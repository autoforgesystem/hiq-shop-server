import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

/** Turns common database errors into clear HTTP responses instead of 500s. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('Prisma');

  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const map: Record<string, [number, string]> = {
      P2002: [HttpStatus.CONFLICT, 'A record with these details already exists.'],
      P2003: [HttpStatus.CONFLICT, 'This record is still linked to other records.'],
      P2025: [HttpStatus.NOT_FOUND, 'Record not found.'],
    };
    const hit = map[e.code];
    if (!hit) {
      this.log.error(`${e.code}: ${e.message}`);
      return res.status(500).json({ statusCode: 500, message: 'Internal server error' });
    }
    res.status(hit[0]).json({ statusCode: hit[0], message: hit[1] });
  }
}
