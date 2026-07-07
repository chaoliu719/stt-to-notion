import { config } from "./config.js";

export interface StructuredNote {
  title: string;
  summary: string;
  category: "想法" | "任务" | "记录" | "灵感";
  tags: string[];
  structured: string;
}

const SYSTEM_PROMPT = `你是一个录音笔记整理助手。整理用户的录音转写文本，以 JSON 格式返回，字段包括：
- title：一句话标题
- summary：2-3句摘要
- category：从 想法/任务/记录/灵感 四选一
- tags：字符串数组
- structured：规整后的正文 Markdown

只返回 JSON 对象，不要任何多余文字。`;

interface OpenAIResponse {
  choices: Array<{
    message: { content: string };
  }>;
}

export async function structureNote(transcriptText: string): Promise<StructuredNote> {
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
  if (!res.ok) throw new Error(`AI request failed: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as OpenAIResponse;
  const content = data.choices[0].message.content;
  return parseJson(content);
}

function parseJson(content: string): StructuredNote {
  const blockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = blockMatch ? blockMatch[1].trim() : content.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]);
    throw new Error("AI response is not valid JSON");
  }
}
