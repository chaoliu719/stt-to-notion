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
  },
  dashscope: {
    apiKey: required("DASHSCOPE_API_KEY"),
    asrBaseUrl: process.env.DASHSCOPE_ASR_BASE_URL ?? "https://dashscope.aliyuncs.com",
    llmBaseUrl: process.env.DASHSCOPE_LLM_BASE_URL ?? "https://dashscope.aliyuncs.com",
    asrModel: process.env.ASR_MODEL ?? "fun-asr",
    llmModel: process.env.LLM_MODEL ?? "qwen-plus",
    systemPrompt: process.env.SYSTEM_PROMPT,
  },
  notion: {
    token: required("NOTION_TOKEN"),
    databaseId: required("NOTION_DATABASE_ID"),
  },
  // 轮询配置
  poll: {
    initialDelayMs: Number(process.env.POLL_INITIAL_DELAY_MS ?? 5000),
    maxAttempts: Number(process.env.POLL_MAX_ATTEMPTS ?? 30),
    backoffFactor: Number(process.env.POLL_BACKOFF_FACTOR ?? 1.4),
  },
};
