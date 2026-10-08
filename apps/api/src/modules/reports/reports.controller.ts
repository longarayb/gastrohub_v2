import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CSV_SECTIONS,
  Permission,
  csvQuerySchema,
  dayReportQuerySchema,
  periodQuerySchema,
} from '@app/shared';
import type { Response } from 'express';
import type { z } from 'zod';
import { ValidationError } from '../../core/errors/domain-error.js';
import { ApiZodQuery, ZQuery } from '../../core/validation/zod.js';
import { RequirePermissions } from '../auth/auth.decorators.js';
import { LossesReportService } from './losses-report.service.js';
import { lossesCsv, salesCsv, timesCsv } from './reports-csv.js';
import { ReportsService } from './reports.service.js';

/** Dashboard and reports (docs/DECISOES.md D038): owners and managers. */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly losses: LossesReportService,
  ) {}

  @Get('day')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({ summary: 'Dashboard do dia (tempo real) com comparação' })
  @ApiZodQuery(dayReportQuerySchema)
  day(@ZQuery(dayReportQuerySchema) query: z.output<typeof dayReportQuerySchema>) {
    return this.reports.day(query);
  }

  @Get('sales')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({
    summary:
      'Vendas por período: produtos (ABC), categorias, pagamentos, canais, horários, garçons',
  })
  @ApiZodQuery(periodQuerySchema)
  sales(@ZQuery(periodQuerySchema) query: z.output<typeof periodQuerySchema>) {
    return this.reports.sales(query);
  }

  @Get('losses')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({
    summary:
      'Controle de perdas: cancelamentos, estornos, descontos, taxas retiradas, reimpressões',
  })
  @ApiZodQuery(periodQuerySchema)
  lossesReport(@ZQuery(periodQuerySchema) query: z.output<typeof periodQuerySchema>) {
    return this.losses.losses(query);
  }

  @Get('times')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({ summary: 'Tempos de preparo por setor e produto (KDS)' })
  @ApiZodQuery(periodQuerySchema)
  times(@ZQuery(periodQuerySchema) query: z.output<typeof periodQuerySchema>) {
    return this.losses.times(query);
  }

  @Get(':report/csv')
  @RequirePermissions(Permission.REPORTS_READ)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Exporta uma seção do relatório em CSV (Excel pt-BR)' })
  @ApiZodQuery(csvQuerySchema)
  async csv(
    @Param('report') report: string,
    @ZQuery(csvQuerySchema) query: z.output<typeof csvQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const sections = CSV_SECTIONS[report as keyof typeof CSV_SECTIONS] as
      readonly string[] | undefined;
    if (!sections?.includes(query.section))
      throw new ValidationError('Seção do relatório desconhecida');
    const period = { from: query.from, to: query.to };
    let body: string;
    if (report === 'sales')
      body = salesCsv(await this.reports.sales({ ...period, scope: 'STORE' }), query.section);
    else if (report === 'losses') body = lossesCsv(await this.losses.losses(period), query.section);
    else body = timesCsv(await this.losses.times(period), query.section);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report}-${query.section}-${query.from}-a-${query.to}.csv"`,
    );
    return body;
  }
}
