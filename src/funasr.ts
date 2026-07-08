import { config } from "./config.js";
import { logger, type Logger } from "./logger.js";

const BASE = `${config.dashscope.asrBaseUrl}/api/v1`;
const HEADERS = {
  Authorization: `Bearer ${config.dashscope.apiKey}`,
  "Content-Type": "application/json",
};

interface SubmitResponse {
  output: { task_id: string };
}

interface TaskResponse {
  output: {
    task_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
    results?: Array<{ transcription_url: string }>;
  };
}

interface Transcript {
  text: string;
  sentences?: Array<{ begin_time: number; end_time: number; text: string }>;
}

export async function submitTranscription(fileUrl: string, log: Logger = logger): Promise<string> {
  const res = await fetch(`${BASE}/services/audio/asr/transcription`, {
    method: "POST",
    headers: { ...HEADERS, "X-DashScope-Async": "enable" },
    body: JSON.stringify({
      model: config.dashscope.asrModel,
      input: { file_urls: [fileUrl] },
      parameters: {},
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    log.error(`提交转写失败 status=${res.status}`, body);
    throw new Error(`Submit failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as SubmitResponse;
  log.debug(`提交转写成功 funasr_task_id=${data.output.task_id}`);
  return data.output.task_id;
}

export async function pollUntilDone(taskId: string, log: Logger = logger): Promise<string> {
  const { initialDelayMs, maxAttempts, backoffFactor } = config.poll;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(delay);
    delay = Math.round(delay * backoffFactor);

    const res = await fetch(`${BASE}/tasks/${taskId}`, { headers: HEADERS });
    if (!res.ok) {
      log.error(`轮询失败 #${attempt} status=${res.status}`);
      throw new Error(`Poll failed: ${res.status}`);
    }
    const data = (await res.json()) as TaskResponse;

    const { task_status, results } = data.output;
    if (task_status === "SUCCEEDED" && results?.[0]?.transcription_url) {
      log.info(`轮询 #${attempt} status=SUCCEEDED`);
      return results[0].transcription_url;
    }
    if (task_status === "FAILED") {
      log.error(`轮询 #${attempt} status=FAILED`);
      throw new Error(`Transcription task ${taskId} failed`);
    }
    log.info(`轮询 #${attempt} status=${task_status} 下次 ${Math.round(delay / 1000)}s 后`);
  }
  log.error(`轮询超时，已尝试 ${maxAttempts} 次`);
  throw new Error(`Transcription timed out after ${maxAttempts} attempts`);
}

export async function fetchTranscript(transcriptionUrl: string, log: Logger = logger): Promise<Transcript> {
  const res = await fetch(transcriptionUrl);
  if (!res.ok) {
    log.error(`获取转写文本失败 status=${res.status}`);
    throw new Error(`Fetch transcript failed: ${res.status}`);
  }
  const data = await res.json() as { transcripts: Transcript[] };
  return data.transcripts[0];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
