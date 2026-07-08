import { config } from "./config.js";
import { logger, type Logger } from "./logger.js";
import { CATEGORY_OPTIONS, SYSTEM_PROMPT, type StructuredNote } from "./note-schema.js";

interface OpenAIResponse {
  choices: Array<{
    message: { content: string };
  }>;
}

export async function structureNote(transcriptText: string, log: Logger = logger): Promise<StructuredNote> {
  log.debug(`AI 整理开始 transcript长度=${transcriptText.length}`);
  const res = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.dashscope.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.dashscope.llmModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `以下是录音转写文本，请整理：\n\n${transcriptText}` },
        ],
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    log.error(`AI 请求失败 status=${res.status}`, body);
    throw new Error(`AI request failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as OpenAIResponse;
  const content = data.choices[0].message.content;
  return normalizeNote(parseJson(content, log), log);
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

function normalizeNote(note: StructuredNote, log: Logger): StructuredNote {
  if (!CATEGORY_OPTIONS.includes(note.category)) {
    log.warn(`AI 返回了非法 category="${note.category}"，回退为"记录"`);
    note.category = "记录";
  }
  return note;
}
