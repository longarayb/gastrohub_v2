import { Global, Module } from '@nestjs/common';
import { dbProvider, DB } from '../tenancy/db.provider.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, TenantContext, dbProvider],
  exports: [PrismaService, TenantContext, DB],
})
export class PrismaModule {}
