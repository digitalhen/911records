import 'server-only';
// Box/collection ZIPs in S3 (DOWNLOADS_S3=s3://bucket/prefix, e.g. s3://my-files/downloads), for
// deployments that keep files in S3 (deploy/aws). The app reads the catalog from the bucket and,
// after /api/downloads' captcha and catalog checks pass, redirects to a 15-minute presigned URL,
// so archive bytes never pass through an app copy. CloudFront must not serve this prefix
// publicly (the Terraform in deploy/aws only exposes pdf/, page/ and text/). Credentials come from
// the default AWS chain (the ECS task role). Unset: archives stream through FILES_URL as before.
import type { S3Client } from '@aws-sdk/client-s3';

const PRESIGN_SECONDS = 900;

export function downloadsS3(): { bucket: string; prefix: string } | null {
  const raw = (process.env.DOWNLOADS_S3 || '').trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 's3:') throw new Error('DOWNLOADS_S3 must look like s3://bucket/prefix');
  return { bucket: url.hostname, prefix: url.pathname.replace(/^\/+|\/+$/g, '') };
}

let client: S3Client | undefined;
async function s3(): Promise<S3Client> {
  const { S3Client } = await import('@aws-sdk/client-s3');
  client ??= new S3Client({});
  return client;
}

const key = (prefix: string, name: string) => (prefix ? `${prefix}/${name}` : name);

/** The catalog (index.json) text, or null if it is missing. */
export async function readIndexFromS3(): Promise<string | null> {
  const cfg = downloadsS3();
  if (!cfg) return null;
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  try {
    const out = await (await s3()).send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key(cfg.prefix, 'index.json') }));
    return (await out.Body?.transformToString()) ?? null;
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') return null;
    throw err;
  }
}

/** A short-lived GET URL for one archive, saved under `filename`. */
export async function presignedArchiveUrl(file: string, filename: string, contentType: string): Promise<string> {
  const cfg = downloadsS3();
  if (!cfg) throw new Error('DOWNLOADS_S3 is not set');
  const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([
    import('@aws-sdk/client-s3'),
    import('@aws-sdk/s3-request-presigner'),
  ]);
  const command = new GetObjectCommand({
    Bucket: cfg.bucket,
    Key: key(cfg.prefix, file),
    ResponseContentDisposition: `attachment; filename="${filename}"`,
    ResponseContentType: contentType,
  });
  return getSignedUrl(await s3(), command, { expiresIn: PRESIGN_SECONDS });
}
