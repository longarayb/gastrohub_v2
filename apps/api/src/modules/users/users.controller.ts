import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateUserInput,
  Permission,
  type Role,
  type UpdateUserInput,
  createUserSchema,
  updateUserSchema,
} from '@gastrohub/shared';
import { ApiZodBody, ZBody } from '../../core/validation/zod.js';
import { RequirePermissions } from '../auth/auth.decorators.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@RequirePermissions(Permission.USERS_MANAGE)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os usuários da unidade' })
  list() {
    return this.users.list();
  }

  @Post()
  @ApiOperation({ summary: 'Cria usuário ou dá acesso a um usuário existente' })
  @ApiZodBody(createUserSchema)
  create(@ZBody(createUserSchema) body: CreateUserInput & { role: Role }) {
    return this.users.create(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza papel, status ou dados do usuário' })
  @ApiZodBody(updateUserSchema)
  update(@Param('id') id: string, @ZBody(updateUserSchema) body: UpdateUserInput) {
    return this.users.update(id, body);
  }
}
