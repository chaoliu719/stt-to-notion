import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { buildOssKey, getPresignedUrl, uploadAudio } from "./oss.js";
import { fetchTranscript, pollUntilDone, submitTranscription } from "./funasr.js";
import { structureNote } from "./ai.js";
import { writeToNotion } from "./notion.js";
import { config } from "./config.js";

const app = new Hono();

app.post("/voice-memo", async (c) => {
  let ossKey = "";
  try {
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return c.json({ success: false, message: "Missing audio file (field: file)" }, 400);
    }

    // 1. 上传 OSS
    const buffer = Buffer.from(await file.arrayBuffer());
    ossKey = buildOssKey(file.name || "recording.m4a");
    await uploadAudio(ossKey, buffer);
    console.log(`[1/5] Uploaded to OSS: ${ossKey}`);

    // 2. 提交转写任务
    const presignedUrl = getPresignedUrl(ossKey);
    const taskId = await submitTranscription(presignedUrl);
    console.log(`[2/5] Submitted task: ${taskId}`);

    // 3. 轮询直到完成（指数退避）
    const transcriptionUrl = await pollUntilDone(taskId);
    console.log(`[3/5] Transcription ready`);

    // 4. 获取转写文本 → AI 整理
    const transcript = await fetchTranscript(transcriptionUrl);
    const note = await structureNote(transcript.text);
    console.log(`[4/5] AI structured: ${note.title}`);

    // 5. 写入 Notion
    await writeToNotion(note, ossKey);
    console.log(`[5/5] Written to Notion`);

    return c.json({ success: true, message: "转写完成并已写入 Notion", title: note.title });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error (ossKey=${ossKey}):`, message);
    return c.json({ success: false, message }, 500);
  }
});

app.get("/health", (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`transcribe-service running on :${config.port}`);
});
