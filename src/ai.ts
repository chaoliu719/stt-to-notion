import OpenAI from "openai";
import { config } from "./config.js";
import { logger, type Logger } from "./logger.js";
import { buildSystemPrompt, type StructuredNote } from "./note-schema.js";

const client = new OpenAI({
  apiKey: config.dashscope.apiKey,
  baseURL: `${config.dashscope.llmBaseUrl}/compatible-mode/v1`,
});

export async function structureNote(
  transcriptText: string,
  categories: readonly string[],
  log: Logger = logger
): Promise<StructuredNote> {
  log.debug(`AI 整理开始 transcript长度=${transcriptText.length} 可选分类=${categories.join("/")}`);

  // 用流式请求代替一次性等待完整响应：持续有数据流动，避免长耗时请求被中间网络当作空闲连接掐断
  // enable_thinking 是 DashScope 扩展参数，关闭思考模型的推理过程以减少耗时
  const stream = await client.chat.completions.create({
    model: config.dashscope.llmModel,
    messages: [
      { role: "system", content: buildSystemPrompt(categories) },
      { role: "user", content: `以下是录音转写文本，请整理：\n\n${transcriptText}` },
    ],
    stream: true,
    enable_thinking: false,
  } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);

  let content = "";
  let reasoning = "";
  let lastLogAt = Date.now();
  let loggedContentLen = 0;
  let loggedReasoningLen = 0;
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta as { content?: string; reasoning_content?: string } | undefined;
    content += delta?.content ?? "";
    reasoning += delta?.reasoning_content ?? "";
    const now = Date.now();
    if (now - lastLogAt >= 1_500) {
      const newReasoning = reasoning.slice(loggedReasoningLen);
      const newContent = content.slice(loggedContentLen);
      if (newReasoning) log.info(`AI 新增思考: ${newReasoning}`);
      if (newContent) log.info(`AI 新增内容: ${newContent}`);
      loggedReasoningLen = reasoning.length;
      loggedContentLen = content.length;
      lastLogAt = now;
    }
  }
  log.debug(`AI 思考过程: ${reasoning}`);
  log.debug(`AI 返回完整内容: ${content}`);

  return normalizeNote(parseJson(content, log), transcriptText, categories, log);
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

function normalizeNote(
  note: StructuredNote,
  transcriptText: string,
  categories: readonly string[],
  log: Logger
): StructuredNote {
  // 回退到第一个选项：Notion 的分类是用户随时可改的，写入不存在的选项会让 Notion 自动新建，反而破坏用户的分类体系
  if (!categories.includes(note.category)) {
    const fallback = categories[0];
    log.warn(`AI 返回了非法 category="${note.category}"，回退为"${fallback}"`);
    note.category = fallback;
  }
  if (!note.cleanedTranscript || !note.cleanedTranscript.trim()) {
    log.warn("AI 未返回 cleanedTranscript，回退为原始转写文本");
    note.cleanedTranscript = transcriptText;
  }
  return note;
}
