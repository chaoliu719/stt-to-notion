import { config } from "./config.js";
import type { StructuredNote } from "./ai.js";
import { logger, type Logger } from "./logger.js";

const NOTION_API = "https://api.notion.com/v1";
const HEADERS = {
  Authorization: `Bearer ${config.notion.token}`,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28",
};

export async function writeToNotion(note: StructuredNote, ossKey: string, log: Logger = logger): Promise<void> {
  const body = buildNotionPage(note, ossKey);
  const res = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    log.error(`Notion 写入失败 status=${res.status}`, errBody);
    throw new Error(`Notion write failed: ${res.status} ${errBody}`);
  }
  const data = (await res.json()) as { id: string };
  log.info(`Notion 页面创建成功 page_id=${data.id}`);
}

function buildNotionPage(note: StructuredNote, ossKey: string) {
  return {
    parent: { database_id: config.notion.databaseId },
    properties: {
      "标题": { title: [{ text: { content: note.title || "未命名录音" } }] },
      "摘要": { rich_text: [{ text: { content: note.summary || "" } }] },
      "分类": { select: { name: note.category || "记录" } },
      "标签": { multi_select: note.tags.map((tag) => ({ name: tag })) },
      "源文件": { rich_text: [{ text: { content: ossKey } }] },
    },
    children: markdownToBlocks(note.structured || ""),
  };
}

type RichTextSpan = { type: "text"; text: { content: string }; annotations?: { bold?: boolean; italic?: boolean; code?: boolean } };

// 解析行内 **加粗**、*斜体*、`代码` 为带样式的富文本片段
function parseInlineMarkdown(text: string): RichTextSpan[] {
  const spans: RichTextSpan[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ type: "text", text: { content: text.slice(lastIndex, match.index) } });
    }
    if (match[1] !== undefined) {
      spans.push({ type: "text", text: { content: match[1] }, annotations: { bold: true } });
    } else if (match[2] !== undefined) {
      spans.push({ type: "text", text: { content: match[2] }, annotations: { italic: true } });
    } else if (match[3] !== undefined) {
      spans.push({ type: "text", text: { content: match[3] }, annotations: { code: true } });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    spans.push({ type: "text", text: { content: text.slice(lastIndex) } });
  }
  return spans.length > 0 ? spans : [{ type: "text", text: { content: text } }];
}

// Notion 富文本单段最长 2000 字符，需分段
function toRichText(text: string): RichTextSpan[] {
  const spans = parseInlineMarkdown(text);
  const result: RichTextSpan[] = [];
  for (const span of spans) {
    const content = span.text.content;
    for (let i = 0; i < content.length; i += 2000) {
      result.push({ ...span, text: { content: content.slice(i, i + 2000) } });
    }
  }
  return result;
}

function markdownToBlocks(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const blocks: Record<string, unknown>[] = [];
  let listBuffer: { type: "bulleted_list_item" | "numbered_list_item"; text: string }[] = [];

  const flushList = () => {
    for (const item of listBuffer) {
      blocks.push({
        object: "block",
        type: item.type,
        [item.type]: { rich_text: toRichText(item.text) },
      });
    }
    listBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const type = `heading_${level}` as "heading_1" | "heading_2" | "heading_3";
      blocks.push({
        object: "block",
        type,
        [type]: { rich_text: toRichText(heading[2]) },
      });
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      listBuffer.push({ type: "bulleted_list_item", text: bullet[1] });
      continue;
    }

    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      listBuffer.push({ type: "numbered_list_item", text: numbered[1] });
      continue;
    }

    flushList();
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: toRichText(line) },
    });
  }
  flushList();

  // Notion 单次请求最多 100 个子块
  return blocks.slice(0, 100);
}
