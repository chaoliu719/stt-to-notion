import OSS from "ali-oss";
import { config } from "./config.js";

const client = new OSS({
  accessKeyId: config.oss.accessKeyId,
  accessKeySecret: config.oss.accessKeySecret,
  bucket: config.oss.bucket,
  region: config.oss.region,
});

export async function uploadAudio(key: string, buffer: Buffer): Promise<void> {
  await client.put(key, buffer);
}

export function getPresignedUrl(key: string, expiresInSeconds = 3600): string {
  return client.signatureUrl(key, { expires: expiresInSeconds });
}

export function buildOssKey(originalName: string): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
  return `${ts}_${originalName}`;
}
