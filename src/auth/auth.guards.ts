import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export type TokenPayload = { sub: string; kind: 'customer' } | { sub: string; kind: 'admin'; role: string };
type AuthedRequest = Request & { auth?: TokenPayload };

const bearer = (req: Request) => {
  const [type, token] = (req.headers.authorization ?? '').split(' ');
  return type === 'Bearer' && token ? token : null;
};

@Injectable()
class TokenReader {
  constructor(private readonly jwt: JwtService) {}
  async read(req: AuthedRequest): Promise<TokenPayload | null> {
    const token = bearer(req);
    if (!token) return null;
    try {
      return await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      return null;
    }
  }
}
export { TokenReader };

/** Requires a signed-in customer. */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly tokens: TokenReader) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const p = await this.tokens.read(req);
    if (!p || p.kind !== 'customer') throw new UnauthorizedException('Please sign in.');
    req.auth = p;
    return true;
  }
}

/** Lets guests through, but attaches the customer when a valid token is sent (guest checkout, bookings). */
@Injectable()
export class OptionalCustomerGuard implements CanActivate {
  constructor(private readonly tokens: TokenReader) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const p = await this.tokens.read(req);
    if (p?.kind === 'customer') req.auth = p;
    return true;
  }
}

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

/** Requires a signed-in admin, optionally with one of the roles from @Roles(). */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly tokens: TokenReader, private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const p = await this.tokens.read(req);
    if (!p || p.kind !== 'admin') throw new UnauthorizedException('Admin sign-in required.');
    const roles = this.reflector.getAllAndOverride<string[] | undefined>('roles', [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(p.role)) throw new ForbiddenException('Your admin role cannot do this.');
    req.auth = p;
    return true;
  }
}

/** The signed-in customer's id, or undefined for guests (with OptionalCustomerGuard). */
export const CustomerId = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const a = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  return a?.kind === 'customer' ? a.sub : undefined;
});

/** The signed-in admin's id. */
export const AdminId = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const a = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  return a?.kind === 'admin' ? a.sub : undefined;
});
