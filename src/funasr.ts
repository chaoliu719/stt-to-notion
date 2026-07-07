import { config } from "./config.js";

const BASE = "https://llm-9bd7zrazwsfma54y.cn-beijing.maas.aliyuncs.com/api/v1";
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

export async function submitTranscription(fileUrl: string): Promise<string> {
  const res = await fetch(`${BASE}/services/audio/asr/transcription`, {
    method: "POST",
    headers: { ...HEADERS, "X-DashScope-Async": "enable" },
    body: JSON.stringify({
      model: config.dashscope.asrModel,
      input: { file_urls: [fileUrl] },
      parameters: {},
    }),
  });
  if (!res.ok) throw new Error(`Submit failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as SubmitResponse;
  return data.output.task_id;
}

export async function pollUntilDone(taskId: string): Promise<string> {
  const { initialDelayMs, maxAttempts, backoffFactor } = config.poll;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(delay);
    delay = Math.round(delay * backoffFactor);

    const res = await fetch(`${BASE}/tasks/${taskId}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
    const data = (await res.json()) as TaskResponse;

    const { task_status, results } = data.output;
    if (task_status === "SUCCEEDED" && results?.[0]?.transcription_url) {
      return results[0].transcription_url;
    }
    if (task_status === "FAILED") {
      throw new Error(`Transcription task ${taskId} failed`);
    }
  }
  throw new Error(`Transcription timed out after ${maxAttempts} attempts`);
}

export async function fetchTranscript(transcriptionUrl: string): Promise<Transcript> {
  const res = await fetch(transcriptionUrl);
  if (!res.ok) throw new Error(`Fetch transcript failed: ${res.status}`);
  const data = await res.json() as { transcripts: Transcript[] };
  return data.transcripts[0];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
