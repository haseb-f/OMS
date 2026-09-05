/**
 * Creates the private oms-attachments bucket when SUPABASE_URL +
 * service role are present. Safe to re-run (409 = already exists).
 */
const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const bucket = process.env.OMS_ATTACHMENTS_BUCKET ?? 'oms-attachments';

async function main() {
  if (!url || !key) {
    console.log('SKIP: Supabase storage credentials are not configured.');
    return;
  }
  const headers = {
    Authorization: `Bearer ${key}`,
    apikey: key,
    'Content-Type': 'application/json',
  };
  const existing = await fetch(`${url}/storage/v1/bucket/${bucket}`, {
    headers,
  });
  if (existing.ok) {
    console.log(`BUCKET_EXISTS name=${bucket} public=false`);
    return;
  }
  const created = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
      ],
    }),
  });
  if (created.ok || created.status === 409) {
    console.log(`BUCKET_READY name=${bucket} public=false`);
    return;
  }
  console.error(`BUCKET_CREATE_FAILED status=${created.status}`);
  process.exit(1);
}

void main();
