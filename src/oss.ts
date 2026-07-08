import OSS from "ali-oss";
import { config } from "./config.js";
import { logger, startTimer, type Logger } from "./logger.js";

const baseOptions = {
  accessKeyId: config.oss.accessKeyId,
  accessKeySecret: config.oss.accessKeySecret,
  bucket: config.oss.bucket,
  region: config.oss.region,
  timeout: 300000,
};

// 上传走内网 endpoint：与 ECS 同地域，速度更快、不计流量费
const uploadClient = new OSS({ ...baseOptions, internal: config.oss.internal });

// 签名 URL 必须用公网 endpoint：FunASR 转写服务从公网拉取音频
const publicClient = new OSS(baseOptions);

export async function uploadAudio(key: string, buffer: Buffer, log: Logger = logger): Promise<void> {
  const endpointMode = config.oss.internal ? "internal" : "public";
  log.debug(`OSS 上传开始 key=${key} size=${buffer.length}B endpoint=${endpointMode}`);
  const elapsed = startTimer();
  await uploadClient.put(key, buffer);
  log.debug(`OSS 上传结束 key=${key} 耗时=${elapsed()}`);
}

export function getPresignedUrl(key: string, expiresInSeconds = 3600): string {
  return publicClient.signatureUrl(key, { expires: expiresInSeconds });
}

export function buildOssKey(originalName: string): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
  return `${ts}_${originalName}`;
}
