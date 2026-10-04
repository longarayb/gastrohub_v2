import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AuthSession,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  switchStoreSchema,
} from '@app/shared';
import type { CookieOptions, Request, Response } from 'express';
import { AppConfig } from '../../core/config/app-config.service.js';
import { ApiZodBody, ZBody } from '../../core/validation/zod.js';
import { type AuthUser, CurrentUser, Public } from './auth.decorators.js';
import { AuthService, type RequestMeta, type SessionWithRefresh } from './auth.service.js';

export const REFRESH_COOKIE = 'app_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cadastra um novo restaurante com o usuário dono' })
  @ApiZodBody(registerSchema)
  async register(
    @ZBody(registerSchema) body: RegisterInput & { cnpj: string; phone: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    return this.respond(res, await this.auth.register(body, meta(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login com e-mail e senha' })
  @ApiZodBody(loginSchema)
  async login(
    @ZBody(loginSchema) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    return this.respond(res, await this.auth.login(body, meta(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renova o access token usando o cookie de refresh' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    try {
      return this.respond(res, await this.auth.refresh(readRefresh(req), meta(req)));
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Encerra a sessão (revoga o refresh token)' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefresh(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Envia e-mail de recuperação de senha' })
  @ApiZodBody(forgotPasswordSchema)
  async forgotPassword(@ZBody(forgotPasswordSchema) body: ForgotPasswordInput): Promise<void> {
    await this.auth.forgotPassword(body.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Redefine a senha com o token recebido por e-mail' })
  @ApiZodBody(resetPasswordSchema)
  async resetPassword(@ZBody(resetPasswordSchema) body: ResetPasswordInput): Promise<void> {
    await this.auth.resetPassword(body);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dados da sessão atual' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub, user.tenantId);
  }

  @Post('switch-store')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Troca a unidade ativa' })
  @ApiZodBody(switchStoreSchema)
  switchStore(
    @CurrentUser() user: AuthUser,
    @ZBody(switchStoreSchema) body: { storeId: string },
  ): Promise<AuthSession> {
    return this.auth.switchStore(user.sub, body.storeId);
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Altera a senha do usuário logado' })
  @ApiZodBody(changePasswordSchema)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @ZBody(changePasswordSchema) body: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(user.sub, body);
  }

  private respond(res: Response, { session, refresh }: SessionWithRefresh): AuthSession {
    res.cookie(REFRESH_COOKIE, refresh.token, {
      ...this.cookieOptions(),
      expires: refresh.expiresAt,
    });
    return session;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: '/api/auth',
    };
  }
}

function meta(req: Request): RequestMeta {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

function readRefresh(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[REFRESH_COOKIE];
}
