'use client';

import { supabase } from './supabase';

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';
const ORG_STORAGE_KEY = 'tda.organisation';

/**
 * Every request carries the Supabase access token. The organisation header only
 * *selects* between organisations the caller already belongs to — the API
 * rejects it otherwise — so it is safe to keep in local storage.
 */
export function getSelectedOrganisation(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ORG_STORAGE_KEY);
}

export function setSelectedOrganisation(organisationId: string | null): void {
  if (typeof window === 'undefined') return;
  if (organisationId) window.localStorage.setItem(ORG_STORAGE_KEY, organisationId);
  else window.localStorage.removeItem(ORG_STORAGE_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Field-level messages, shaped for React Hook Form's setError. */
    readonly fields?: Record<string, string>,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isAuthError() {
    return this.status === 401;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | string[] | undefined | null>;
  /** Return the raw Response instead of parsed JSON, for file downloads. */
  raw?: boolean;
  signal?: AbortSignal;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (data.session?.access_token) {
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const organisation = getSelectedOrganisation();
  if (organisation) headers['x-tda-organisation'] = organisation;
  return headers;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${BASE}${path}`, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return `${url.pathname}${url.search}`;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers: await authHeaders(),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (options.raw) {
    if (!response.ok) await throwFrom(response);
    return response as unknown as T;
  }

  if (response.status === 204) return undefined as T;
  if (!response.ok) await throwFrom(response);
  return (await response.json()) as T;
}

async function throwFrom(response: Response): Promise<never> {
  let code = 'UNKNOWN';
  let message = 'Something went wrong. Try again.';
  let details: unknown;

  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
    details = body.error?.details;
  } catch {
    // A non-JSON error body means the platform, not the application, failed.
    if (response.status === 502 || response.status === 503) {
      message = 'The service is not responding. Try again shortly.';
    }
  }

  const fields =
    details && typeof details === 'object' && !Array.isArray(details)
      ? (details as Record<string, string>)
      : undefined;

  throw new ApiError(response.status, code, message, fields, details);
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  raw: (path: string, options: RequestOptions = {}) => request<Response>(path, { ...options, raw: true }),
};

/**
 * Two-phase evidence upload: ask for a presigned URL, PUT the file straight to
 * R2, then confirm. The file never travels through the API host.
 */
export async function uploadEvidence(input: {
  decisionId: string;
  file: File;
  description?: string;
  version?: string;
  onProgress?: (fraction: number) => void;
}): Promise<{ id: string; filename: string }> {
  const ticket = await api.post<{ uploadId: string; storageKey: string; url: string }>(
    '/attachments/upload-url',
    {
      decisionId: input.decisionId,
      filename: input.file.name,
      contentType: input.file.type,
      sizeBytes: input.file.size,
      description: input.description,
      version: input.version ?? '1.0',
    },
  );

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.url);
    xhr.setRequestHeader('Content-Type', input.file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error('The file could not be uploaded. Try again.'));
    xhr.onerror = () => reject(new Error('The file could not be uploaded. Check your connection.'));
    xhr.send(input.file);
  });

  return api.post('/attachments/confirm', {
    uploadId: ticket.uploadId,
    storageKey: ticket.storageKey,
  });
}

export async function downloadEvidence(attachmentId: string): Promise<void> {
  const { url } = await api.get<{ url: string; filename: string }>(
    `/attachments/${attachmentId}/download`,
  );
  window.open(url, '_blank', 'noopener,noreferrer');
}
