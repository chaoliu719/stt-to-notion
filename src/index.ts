import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { buildOssKey, getPresignedUrl, uploadAudio } from "./oss.js";
import { fetchTranscript, pollUntilDone, submitTranscription } from "./funasr.js";
import { structureNote } from "./ai.js";
import { writeToNotion } from "./notion.js";
import { config } from "./config.js";

const app = new Hono();

async function processVoiceMemo(taskId: string, ossKey: string) {
  try {
    // 1. 提交转写任务
    const presignedUrl = getPresignedUrl(ossKey);
    const funasrTaskId = await submitTranscription(presignedUrl);
    console.log(`[${taskId}] [2/5] Submitted task: ${funasrTaskId}`);

    // 2. 轮询直到完成（指数退避）
    const transcriptionUrl = await pollUntilDone(funasrTaskId);
    console.log(`[${taskId}] [3/5] Transcription ready`);

    // 3. 获取转写文本 → AI 整理
    const transcript = await fetchTranscript(transcriptionUrl);
    const note = await structureNote(transcript.text);
    console.log(`[${taskId}] [4/5] AI structured: ${note.title}`);

    // 4. 写入 Notion
    await writeToNotion(note, ossKey);
    console.log(`[${taskId}] [5/5] Written to Notion`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${taskId}] Error (ossKey=${ossKey}):`, message);
  }
}

app.post("/voice-memo", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return c.json({ success: false, message: "Missing audio file (field: file)" }, 400);
    }

    // 1. 上传 OSS（同步等待，确保文件已落地）
    const buffer = Buffer.from(await file.arrayBuffer());
    const ossKey = buildOssKey(file.name || "recording.m4a");
    await uploadAudio(ossKey, buffer);

    const taskId = randomUUID();
    console.log(`[${taskId}] [1/5] Uploaded to OSS: ${ossKey}`);

    // 2-5. 后台异步执行转写 → AI → Notion，不阻塞响应
    void processVoiceMemo(taskId, ossKey);

    return c.json({ success: true, taskId }, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error during upload:", message);
    return c.json({ success: false, message }, 500);
  }
});

app.get("/health", (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`transcribe-service running on :${config.port}`);
});
