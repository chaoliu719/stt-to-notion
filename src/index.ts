import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { buildOssKey, getPresignedUrl, uploadAudio } from "./oss.js";
import { fetchTranscript, pollUntilDone, submitTranscription } from "./funasr.js";
import { structureNote } from "./ai.js";
import { writeToNotion } from "./notion.js";
import { config } from "./config.js";
import { logger, startTimer } from "./logger.js";

const app = new Hono();

app.use("*", async (c, next) => {
  const elapsed = startTimer();
  await next();
  logger.info(`${c.req.method} ${c.req.path} ${c.res.status} ${elapsed()}`);
});

async function processVoiceMemo(taskId: string, ossKey: string) {
  const log = logger.child(taskId);
  const totalElapsed = startTimer();
  try {
    // 1. 提交转写任务
    let elapsed = startTimer();
    const presignedUrl = getPresignedUrl(ossKey);
    const funasrTaskId = await submitTranscription(presignedUrl, log);
    log.info(`[2/5] 提交转写任务完成 funasr_task_id=${funasrTaskId} 耗时=${elapsed()}`);

    // 2. 轮询直到完成（指数退避）
    elapsed = startTimer();
    const transcriptionUrl = await pollUntilDone(funasrTaskId, log);
    log.info(`[3/5] 转写完成 耗时=${elapsed()}`);

    // 3. 获取转写文本 → AI 整理
    elapsed = startTimer();
    const transcript = await fetchTranscript(transcriptionUrl, log);
    const note = await structureNote(transcript.text, log);
    log.info(`[4/5] AI 整理完成 title=${note.title} category=${note.category} tags=${note.tags.length} 耗时=${elapsed()}`);

    // 4. 写入 Notion
    elapsed = startTimer();
    await writeToNotion(note, ossKey, log);
    log.info(`[5/5] 写入 Notion 完成 耗时=${elapsed()}`);

    log.info(`流水线全部完成 总耗时=${totalElapsed()}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`流水线失败 (ossKey=${ossKey}) 总耗时=${totalElapsed()}`, message);
  }
}

app.post("/voice-memo", async (c) => {
  const taskId = randomUUID();
  const log = logger.child(taskId);
  try {
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return c.json({ success: false, message: "Missing audio file (field: file)" }, 400);
    }

    log.info(`收到上传请求 filename=${file.name} size=${file.size}B`);

    // 1. 上传 OSS（同步等待，确保文件已落地）
    const buffer = Buffer.from(await file.arrayBuffer());
    const ossKey = buildOssKey(file.name || "recording.m4a");
    const elapsed = startTimer();
    await uploadAudio(ossKey, buffer, log);
    log.info(`[1/5] 上传 OSS 完成 key=${ossKey} 耗时=${elapsed()}`);

    // 2-5. 后台异步执行转写 → AI → Notion，不阻塞响应
    void processVoiceMemo(taskId, ossKey);

    return c.json({ success: true, taskId }, 202);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("上传失败", message);
    return c.json({ success: false, message }, 500);
  }
});

app.get("/health", (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: config.port }, () => {
  logger.info(
    `transcribe-service running on :${config.port} ` +
      `oss_region=${config.oss.region} oss_endpoint=${config.oss.internal ? "internal" : "public"} ` +
      `asr_model=${config.dashscope.asrModel} llm_model=${config.dashscope.llmModel} ` +
      `notion_db=${config.notion.databaseId.slice(0, 8)}...`
  );
});
