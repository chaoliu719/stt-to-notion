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
    children: [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: (note.structured || "").slice(0, 2000) } }],
        },
      },
    ],
  };
}
