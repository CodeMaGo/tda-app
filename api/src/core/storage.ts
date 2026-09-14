import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { forbidden } from './http.js';

/**
 * Evidence storage on Cloudflare R2 (S3-compatible).
 *
 * Files never pass through the Functions host: the browser uploads straight to
 * R2 with a short-lived presigned PUT, and downloads with a short-lived GET.
 * Two consequences matter for security:
 *
 *   - every object key is prefixed with the owning organisation id, and
 *     `assertKeyBelongsTo` is called before any URL is signed, so a stolen
 *     attachment id from another tenant cannot be turned into a download;
 *   - the signed URL is the capability, so expiries are short.
 */

let client: S3Client | null = null;

function s3(): S3Client {
  if (client) return client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Cloudflare R2 credentials are not configured');
  }
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

const bucket = () => process.env.R2_BUCKET ?? 'tda-evidence';

const UPLOAD_TTL_SECONDS = 300;
const DOWNLOAD_TTL_SECONDS = 120;

/** `org/<organisationId>/decisions/<decisionId>/<uuid>/<safe-filename>` */
export function buildStorageKey(input: {
  organisationId: string;
  decisionId: string;
  filename: string;
}): string {
  const safe = input.filename
    .normalize('NFKD')
    .replace(/[^\w.\- ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 120);
  return `org/${input.organisationId}/decisions/${input.decisionId}/${randomUUID()}/${safe || 'file'}`;
}

export function assertKeyBelongsTo(organisationId: string, storageKey: string): void {
  if (!storageKey.startsWith(`org/${organisationId}/`)) {
    throw forbidden('That file belongs to another organisation');
  }
}

export async function presignUpload(input: {
  organisationId: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{ url: string; expiresInSeconds: number }> {
  assertKeyBelongsTo(input.organisationId, input.storageKey);
  const url = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: input.storageKey,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
      Metadata: { organisation: input.organisationId },
    }),
    { expiresIn: UPLOAD_TTL_SECONDS },
  );
  return { url, expiresInSeconds: UPLOAD_TTL_SECONDS };
}

export async function presignDownload(input: {
  organisationId: string;
  storageKey: string;
  filename: string;
}): Promise<{ url: string; expiresInSeconds: number }> {
  assertKeyBelongsTo(input.organisationId, input.storageKey);
  const url = await getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: input.storageKey,
      ResponseContentDisposition: `attachment; filename="${input.filename.replace(/"/g, '')}"`,
    }),
    { expiresIn: DOWNLOAD_TTL_SECONDS },
  );
  return { url, expiresInSeconds: DOWNLOAD_TTL_SECONDS };
}

export async function putObject(input: {
  storageKey: string;
  body: Uint8Array | string;
  contentType: string;
}): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: input.storageKey,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}

export async function deleteObject(organisationId: string, storageKey: string): Promise<void> {
  assertKeyBelongsTo(organisationId, storageKey);
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: storageKey }));
}
