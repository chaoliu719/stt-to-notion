import { config } from "./config.js";
import type { StructuredNote } from "./note-schema.js";
import { DEFAULT_CATEGORY_OPTIONS, NOTION_PROPERTIES } from "./note-schema.js";
import { logger, type Logger } from "./logger.js";

const NOTION_API = "https://api.notion.com/v1";
const HEADERS = {
  Authorization: `Bearer ${config.notion.token}`,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28",
};

interface DatabaseResponse {
  properties: Record<string, { type: string; select?: { options?: Array<{ name: string }> } }>;
}

// 每次流水线开始前读一次数据库 schema，让「分类」选项以 Notion 里的实际配置为准：
// 用户在 Notion 里增删分类立即生效，不需要改代码重新部署
export async function fetchCategoryOptions(log: Logger = logger): Promise<string[]> {
  const fallback = [...DEFAULT_CATEGORY_OPTIONS];
  const propName = NOTION_PROPERTIES.category.name;
  try {
    const res = await fetch(`${NOTION_API}/databases/${config.notion.databaseId}`, { headers: HEADERS });
    if (!res.ok) {
      log.warn(`读取 Notion 分类选项失败 status=${res.status}，回退为默认分类`, await res.text());
      return fallback;
    }
    const data = (await res.json()) as DatabaseResponse;
    const options = (data.properties?.[propName]?.select?.options ?? [])
      .map((opt) => opt.name)
      .filter((name) => name.trim().length > 0);
    if (options.length === 0) {
      log.warn(`Notion 属性「${propName}」没有可用选项，回退为默认分类`);
      return fallback;
    }
    return options;
  } catch (err) {
    log.warn(`读取 Notion 分类选项异常，回退为默认分类`, err instanceof Error ? err.message : String(err));
    return fallback;
  }
}

export async function writeToNotion(
  note: StructuredNote,
  ossKey: string,
  transcriptText: string,
  log: Logger = logger
): Promise<void> {
  const body = buildNotionPage(note, ossKey, transcriptText);
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

function buildNotionPage(note: StructuredNote, ossKey: string, transcriptText: string) {
  const children = markdownToBlocks(note.structured || "");
  children.push(buildTranscriptToggle(transcriptText));
  return {
    parent: { database_id: config.notion.databaseId },
    properties: {
      [NOTION_PROPERTIES.title.name]: { title: [{ text: { content: note.title || "未命名录音" } }] },
      [NOTION_PROPERTIES.summary.name]: { rich_text: [{ text: { content: note.summary || "" } }] },
      [NOTION_PROPERTIES.category.name]: { select: { name: note.category } },
      [NOTION_PROPERTIES.tags.name]: { multi_select: (note.tags ?? []).map((tag) => ({ name: tag })) },
      [NOTION_PROPERTIES.sourceFile.name]: { rich_text: [{ text: { content: ossKey } }] },
    },
    children,
  };
}

// 折叠的"原文"板块，存放 AI 规整后的转写全文
function buildTranscriptToggle(transcriptText: string) {
  return {
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: [{ type: "text", text: { content: "原文" } }],
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: toRichText(transcriptText || "") },
        },
      ],
    },
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

type ListItemType = "bulleted_list_item" | "numbered_list_item";
type NotionBlock = Record<string, any>;

// Notion 单次创建请求最多支持两层嵌套（顶层块 + 一层 children），再深会整条请求被拒。
// AI 若产出更深的缩进，统一压平到第 2 层，保证列表仍以原生块渲染而不是回退成原始 Markdown 文本。
const MAX_LIST_LEVEL = 2;

function makeListBlock(type: ListItemType, text: string): NotionBlock {
  return { object: "block", type, [type]: { rich_text: toRichText(text) } };
}

// 把某个列表项挂到父项的 children 下（懒创建 children 数组）
function appendChild(parent: NotionBlock, child: NotionBlock) {
  const body = parent[parent.type as string];
  if (!body.children) body.children = [];
  body.children.push(child);
}

function markdownToBlocks(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const blocks: NotionBlock[] = [];
  // 记录当前打开的列表层级：按缩进量递增，栈顶是最内层；level 是压平后的实际嵌套层（1 起）
  let listStack: { indent: number; level: number; block: NotionBlock }[] = [];

  const resetList = () => {
    listStack = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      resetList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      resetList();
      const level = heading[1].length;
      const type = `heading_${level}` as "heading_1" | "heading_2" | "heading_3";
      blocks.push({
        object: "block",
        type,
        [type]: { rich_text: toRichText(heading[2]) },
      });
      continue;
    }

    // 同时捕获前导缩进，用缩进量判断嵌套层级；支持 -/* 无序与 1. / 1) 有序
    const listItem = line.match(/^(\s*)(?:[-*]|\d+[.)])\s+(.*)$/);
    if (listItem) {
      const indent = listItem[1].replace(/\t/g, "    ").length;
      const text = listItem[2];
      const type: ListItemType = /^\s*\d+[.)]/.test(line) ? "numbered_list_item" : "bulleted_list_item";
      const block = makeListBlock(type, text);

      // 弹出所有缩进 >= 当前项的层级，剩下的栈顶即为父项
      while (listStack.length > 0 && listStack[listStack.length - 1].indent >= indent) {
        listStack.pop();
      }

      // 找到最深的、还没到嵌套上限的祖先做父项；更深的缩进会被压平成它的子项
      let parentIdx = listStack.length - 1;
      while (parentIdx >= 0 && listStack[parentIdx].level >= MAX_LIST_LEVEL) {
        parentIdx--;
      }

      let level: number;
      if (parentIdx < 0) {
        blocks.push(block);
        level = 1;
      } else {
        appendChild(listStack[parentIdx].block, block);
        level = listStack[parentIdx].level + 1;
      }
      listStack.push({ indent, level, block });
      continue;
    }

    resetList();
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: toRichText(line) },
    });
  }

  // Notion 单次请求最多 100 个顶层子块
  // 留一个位置给后面追加的"原文"折叠块
  return blocks.slice(0, 99);
}
