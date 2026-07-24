const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
};

export const config = {
  port: Number(process.env.PORT ?? 3000),
  oss: {
    accessKeyId: required("OSS_ACCESS_KEY_ID"),
    accessKeySecret: required("OSS_ACCESS_KEY_SECRET"),
    bucket: required("OSS_BUCKET"),
    region: process.env.OSS_REGION ?? "oss-cn-hangzhou",
    internal: process.env.OSS_INTERNAL === "true",
  },
  dashscope: {
    apiKey: required("DASHSCOPE_API_KEY"),
    asrBaseUrl: process.env.DASHSCOPE_ASR_BASE_URL ?? "https://dashscope.aliyuncs.com",
    llmBaseUrl: process.env.DASHSCOPE_LLM_BASE_URL ?? "https://dashscope.aliyuncs.com",
    asrModel: process.env.ASR_MODEL ?? "fun-asr",
    llmModel: process.env.LLM_MODEL ?? "qwen-plus",
  },
  notion: {
    token: required("NOTION_TOKEN"),
    databaseId: required("NOTION_DATABASE_ID"),
    // 写入 Notion 的重试配置：应对偶发的网络抖动（fetch failed）、429 限流、5xx 服务端错误
    retry: {
      maxAttempts: Number(process.env.NOTION_RETRY_MAX_ATTEMPTS ?? 3),
      initialDelayMs: Number(process.env.NOTION_RETRY_INITIAL_DELAY_MS ?? 1000),
      backoffFactor: Number(process.env.NOTION_RETRY_BACKOFF_FACTOR ?? 2),
    },
  },
  // 轮询配置
  poll: {
    initialDelayMs: Number(process.env.POLL_INITIAL_DELAY_MS ?? 5000),
    maxAttempts: Number(process.env.POLL_MAX_ATTEMPTS ?? 30),
    backoffFactor: Number(process.env.POLL_BACKOFF_FACTOR ?? 1.4),
  },
};
