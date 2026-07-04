import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { HttpError } from "../services/http-error.js";

/**
 * Standard paginated list query with clamping (Fable T08): a non-numeric value
 * is rejected (400 via the global error handler); an out-of-range value is
 * clamped so `?limit=100000` can never dump a whole table. Centralised here so
 * every factory-built list validates query params identically, instead of the
 * pre-T27 per-route copy-paste drift (finding D4).
 */
export function paginationQuerySchema(options: { maxLimit?: number; defaultLimit?: number } = {}) {
  const maxLimit = options.maxLimit ?? 100;
  const defaultLimit = options.defaultLimit ?? 20;
  return z.object({
    page: z.coerce
      .number()
      .int()
      .transform((n) => Math.max(1, n))
      .default(1),
    limit: z.coerce
      .number()
      .int()
      .transform((n) => Math.min(maxLimit, Math.max(1, n)))
      .default(defaultLimit),
    search: z.string().max(200).optional(),
  });
}

interface RouteGuard {
  /** preHandler for a mutating route, e.g. `requireRole("superadmin")` (Fable T07). */
  preHandler?: preHandlerHookHandler;
}

interface CrudRoutesOptions<TCreate extends z.ZodTypeAny, TUpdate extends z.ZodTypeAny, TItem> {
  /** Path segment, e.g. "presets" → base path "/presets". */
  resource: string;
  /** Route param addressing a single item, e.g. "name" → "/presets/:name" (default "id"). */
  keyParam?: string;
  /** GET /{resource}. `querySchema`, if given, validates & parses the query. */
  list: {
    handler: (query: unknown) => Promise<unknown>;
    querySchema?: z.ZodTypeAny;
  };
  /** POST /{resource} → 201 by default. */
  create?: RouteGuard & {
    schema: TCreate;
    handler: (body: z.infer<TCreate>) => Promise<unknown>;
    status?: number;
  };
  /** PUT /{resource} — upsert with the key in the body (e.g. rate-limit plans). */
  upsert?: RouteGuard & {
    schema: TCreate;
    handler: (body: z.infer<TCreate>) => Promise<unknown>;
    status?: number;
  };
  /** PUT /{resource}/:key — validate, load existing (404 if missing), then persist. */
  update?: RouteGuard & {
    schema: TUpdate;
    findExisting: (key: string) => Promise<TItem | null>;
    handler: (key: string, body: z.infer<TUpdate>, existing: TItem) => Promise<unknown>;
    notFoundMessage?: string;
  };
  /** DELETE /{resource}/:key — 204 No Content unless `respond` shapes the result. */
  remove?: RouteGuard & {
    handler: (key: string) => Promise<unknown>;
    respond?: (result: unknown, reply: FastifyReply) => unknown;
  };
}

function guardOptions(preHandler?: preHandlerHookHandler): { preHandler?: preHandlerHookHandler } {
  return preHandler ? { preHandler } : {};
}

/**
 * Wire a CRUD resource onto a Fastify instance from a repository + zod contracts,
 * so a new admin entity is added by configuration rather than copy-pasting the
 * validate → 404 → status-code boilerplate for every route (Fable T27, D4). Only
 * the operations present in `options` are registered.
 */
export function registerCrudRoutes<TCreate extends z.ZodTypeAny, TUpdate extends z.ZodTypeAny, TItem>(
  app: FastifyInstance,
  options: CrudRoutesOptions<TCreate, TUpdate, TItem>,
): void {
  const key = options.keyParam ?? "id";
  const base = `/${options.resource}`;
  const itemPath = `${base}/:${key}`;

  const keyOf = (request: FastifyRequest): string => (request.params as Record<string, string>)[key] ?? "";

  app.get(base, async (request) => {
    const { list } = options;
    const query = list.querySchema ? list.querySchema.parse(request.query) : request.query;
    return list.handler(query);
  });

  if (options.create) {
    const { schema, handler, status = 201, preHandler } = options.create;
    app.post(base, guardOptions(preHandler), async (request, reply) => {
      const body = schema.parse(request.body);
      const result = await handler(body);
      return reply.status(status).send(result);
    });
  }

  if (options.upsert) {
    const { schema, handler, status = 200, preHandler } = options.upsert;
    app.put(base, guardOptions(preHandler), async (request, reply) => {
      const body = schema.parse(request.body);
      const result = await handler(body);
      return reply.status(status).send(result);
    });
  }

  if (options.update) {
    const { schema, findExisting, handler, notFoundMessage = "Not found", preHandler } = options.update;
    app.put(itemPath, guardOptions(preHandler), async (request) => {
      const keyValue = keyOf(request);
      const body = schema.parse(request.body);
      const existing = await findExisting(keyValue);
      if (!existing) {
        throw new HttpError(404, notFoundMessage);
      }
      return handler(keyValue, body, existing);
    });
  }

  if (options.remove) {
    const { handler, respond, preHandler } = options.remove;
    app.delete(itemPath, guardOptions(preHandler), async (request, reply) => {
      const result = await handler(keyOf(request));
      if (respond) {
        return respond(result, reply);
      }
      return reply.status(204).send();
    });
  }
}
