import OpenAI from "openai";
import { config } from "./config.js";
import { logger, type Logger } from "./logger.js";
import { CATEGORY_OPTIONS, SYSTEM_PROMPT, type StructuredNote } from "./note-schema.js";

const client = new OpenAI({
  apiKey: config.dashscope.apiKey,
  baseURL: `${config.dashscope.llmBaseUrl}/compatible-mode/v1`,
});

export async function structureNote(transcriptText: string, log: Logger = logger): Promise<StructuredNote> {
  log.debug(`AI 整理开始 transcript长度=${transcriptText.length}`);

  // 用流式请求代替一次性等待完整响应：持续有数据流动，避免长耗时请求被中间网络当作空闲连接掐断
  const stream = await client.chat.completions.create({
    model: config.dashscope.llmModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `以下是录音转写文本，请整理：\n\n${transcriptText}` },
    ],
    stream: true,
  });

  let content = "";
  let lastLogAt = Date.now();
  for await (const chunk of stream) {
    content += chunk.choices[0]?.delta?.content ?? "";
    const now = Date.now();
    if (now - lastLogAt >= 10_000) {
      log.info(`AI 整理进行中 已接收长度=${content.length}`);
      lastLogAt = now;
    }
  }
  log.debug(`AI 返回完整内容: ${content}`);

  return normalizeNote(parseJson(content, log), transcriptText, log);
}

function parseJson(content: string, log: Logger): StructuredNote {
  const blockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = blockMatch ? blockMatch[1].trim() : content.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {
        // fall through to error below
      }
    }
    log.error("AI 返回内容不是合法 JSON", content.slice(0, 500));
    throw new Error("AI response is not valid JSON");
  }
}

function normalizeNote(note: StructuredNote, transcriptText: string, log: Logger): StructuredNote {
  if (!CATEGORY_OPTIONS.includes(note.category)) {
    log.warn(`AI 返回了非法 category="${note.category}"，回退为"记录"`);
    note.category = "记录";
  }
  if (!note.cleanedTranscript || !note.cleanedTranscript.trim()) {
    log.warn("AI 未返回 cleanedTranscript，回退为原始转写文本");
    note.cleanedTranscript = transcriptText;
  }
  return note;
}
