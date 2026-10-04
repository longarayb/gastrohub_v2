import {
  type ArgumentMetadata,
  Body,
  Injectable,
  type PipeTransform,
  Query,
  applyDecorators,
} from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

/** Validates and transforms a value with a Zod schema. Errors become 400 via the global filter. */
@Injectable()
export class ZodValidationPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.output<T> {
    return this.schema.parse(value);
  }
}

function toOpenApi(schema: ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >;
  } catch {
    return { type: 'object' };
  }
}

/** `@ZBody(schema)` — validated request body, documented in Swagger. */
export const ZBody = (schema: ZodType) => Body(new ZodValidationPipe(schema));

/** `@ZQuery(schema)` — validated query string. */
export const ZQuery = (schema: ZodType) => Query(new ZodValidationPipe(schema));

/** Documents a Zod request body in Swagger. Use together with `@ZBody`. */
export const ApiZodBody = (schema: ZodType) =>
  applyDecorators(ApiBody({ schema: toOpenApi(schema) as never }));

/** Documents each top-level field of a Zod object as a query parameter. */
export function ApiZodQuery(schema: ZodType) {
  const json = toOpenApi(schema) as { properties?: Record<string, object>; required?: string[] };
  const decorators = Object.entries(json.properties ?? {}).map(([name, prop]) =>
    ApiQuery({ name, required: json.required?.includes(name) ?? false, schema: prop as never }),
  );
  return applyDecorators(...decorators);
}
