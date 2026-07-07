import { config } from "./config.js";
import type { StructuredNote } from "./ai.js";

const NOTION_API = "https://api.notion.com/v1";
const HEADERS = {
  Authorization: `Bearer ${config.notion.token}`,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28",
};

export async function writeToNotion(note: StructuredNote, ossKey: string): Promise<void> {
  const body = buildNotionPage(note, ossKey);
  const res = await fetch(`${NOTION_API}/pages`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion write failed: ${res.status} ${await res.text()}`);
}

function buildNotionPage(note: StructuredNote, ossKey: string) {
  return {
    parent: { database_id: config.notion.databaseId },
    properties: {
      Name: { title: [{ text: { content: note.title } }] },
      Summary: { rich_text: [{ text: { content: note.summary } }] },
      Category: { select: { name: note.category } },
      Tags: { multi_select: note.tags.map((tag) => ({ name: tag })) },
      OSSKey: { rich_text: [{ text: { content: ossKey } }] },
    },
    children: [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: note.structured } }],
        },
      },
    ],
  };
}
