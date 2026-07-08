import { readFileSync } from "fs";
import { config } from "./config.js";
import { logger, type Logger } from "./logger.js";

export interface StructuredNote {
  title: string;
  summary: string;
  category: "想法" | "任务" | "记录" | "灵感";
  tags: string[];
  structured: string;
}

const DEFAULT_SYSTEM_PROMPT = `你是一个录音笔记整理助手。整理用户的录音转写文本，以 JSON 格式返回，字段包括：
- title：一句话标题
- summary：2-3句摘要
- category：从 想法/任务/记录/灵感 四选一
- tags：字符串数组
- structured：规整后的正文 Markdown

只返回 JSON 对象，不要任何多余文字。`;

function loadSystemPrompt(log: Logger): string {
  const promptPath = process.env.PROMPT_FILE ?? "/app/prompt.txt";
  try {
    const prompt = readFileSync(promptPath, "utf-8").trim();
    log.debug(`使用外部 prompt 文件 ${promptPath}`);
    return prompt;
  } catch {
    log.debug("使用内置默认 prompt");
    return DEFAULT_SYSTEM_PROMPT;
  }
}

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
          { role: "system", content: loadSystemPrompt(log) },
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
  return parseJson(content, log);
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
