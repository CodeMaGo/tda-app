import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { z, type ZodTypeAny } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorised = (message = 'Sign in to continue') =>
  new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have access to this') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (what = 'That record') =>
  new HttpError(404, 'NOT_FOUND', `${what} was not found`);
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, 'CONFLICT', message, details);
export const unprocessable = (message: string, details?: unknown) =>
  new HttpError(422, 'UNPROCESSABLE', message, details);

export function json(body: unknown, status = 200): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: { 'Cache-Control': 'no-store' },
  };
}

export const noContent = (): HttpResponseInit => ({ status: 204 });

/** Parse and validate a JSON request body. */
export async function readBody<S extends ZodTypeAny>(
  request: HttpRequest,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest('The request body is not valid JSON');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw unprocessable('Some fields need attention', flattenIssues(result.error));
  }
  return result.data;
}

/** Parse query string parameters through a schema, coercing scalars. */
export function readQuery<S extends ZodTypeAny>(request: HttpRequest, schema: S): z.infer<S> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of request.query.entries()) {
    const existing = raw[key];
    if (existing === undefined) raw[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else raw[key] = [existing, value];
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw badRequest('Some search parameters are not valid', flattenIssues(result.error));
  }
  return result.data;
}

/** Turn Zod issues into `{ field: message }` for React Hook Form. */
export function flattenIssues(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    fields[path] ??= issue.message;
  }
  return fields;
}

export function routeParam(request: HttpRequest, name: string): string {
  const value = request.params[name];
  if (!value) throw badRequest(`Missing ${name} in the request path`);
  return value;
}

export function uuidParam(request: HttpRequest, name: string): string {
  const value = routeParam(request, name);
  if (!z.string().uuid().safeParse(value).success) throw notFound();
  return value;
}

/** Comma-separated query values, e.g. ?statuses=draft,approved */
export const csv = <T extends string>(values: readonly T[]) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const list = (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean);
      return list.filter((s): s is T => (values as readonly string[]).includes(s));
    });

export const boolQuery = z
  .union([z.string(), z.boolean()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === true || v === 'true' || v === '1'));

export const intQuery = (fallback: number, min: number, max: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      const n = v === undefined ? fallback : Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, Math.trunc(n)));
    });
