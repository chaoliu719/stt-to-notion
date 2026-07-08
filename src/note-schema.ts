export const CATEGORY_OPTIONS = ["想法", "任务", "记录", "灵感"] as const;
export type Category = (typeof CATEGORY_OPTIONS)[number];

export interface StructuredNote {
  title: string;
  summary: string;
  category: Category;
  tags: string[];
  structured: string;
  cleanedTranscript: string;
}

// 对应 Notion database 的属性 schema：字段名 + Notion 属性名 + 属性类型
export const NOTION_PROPERTIES = {
  title: { name: "标题", type: "title" },
  summary: { name: "摘要", type: "rich_text" },
  category: { name: "分类", type: "select" },
  tags: { name: "标签", type: "multi_select" },
  sourceFile: { name: "源文件", type: "rich_text" },
} as const;

export const SYSTEM_PROMPT = `你是一个录音笔记整理助手。整理用户的录音转写文本，以 JSON 格式返回，字段包括：
- title：一句话标题
- summary：2-3句摘要
- category：从 ${CATEGORY_OPTIONS.join("/")} 四选一
- tags：字符串数组
- structured：规整后的正文 Markdown
- cleanedTranscript：对原始转写文本做规整——只加标点、分段、去掉口语冗余词（嗯/啊/重复词等），禁止改变原意、禁止摘要或删减信息、禁止改写措辞，逐字保留原始信息

只返回 JSON 对象，不要任何多余文字。`;
