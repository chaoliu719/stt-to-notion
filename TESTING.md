# 本地测试流程

改动 `src/` 下代码后，push 前应先在本地 Docker 环境跑一遍完整流水线（上传 → OSS → ASR 转写 → AI 整理 → 写入 Notion），确认没有回归。

## 分工

**Claude 负责：**
1. 构建本地镜像并启动容器
2. 询问用户测试录音文件的路径
3. 用 curl 上传文件触发流水线
4. 持续监控容器日志，直到流水线跑完（成功或失败）
5. 用 Notion MCP 检查新建的 Notion 页面，确认内容正确

**用户负责：**
1. 提供一个真实的测试录音文件路径（m4a/mp3/wav 等）
2. 确保 Docker daemon（OrbStack / Docker Desktop）已启动
3. 确认 Notion 页面检查结果是否符合预期

## 前置条件

- `.env` 文件已存在且配置齐全（OSS、DashScope、Notion token 等），可直接复用现有配置，不要重新生成
- Docker daemon 正在运行；若未运行，提醒用户启动

## 步骤

### 1. 构建镜像

```bash
docker build -t stt-to-notion:local .
```

### 2. 启动容器

复用项目里的 `.env`：

```bash
docker rm -f stt-to-notion-local 2>/dev/null
docker run -d --name stt-to-notion-local -p 3000:3000 \
  --env-file .env \
  stt-to-notion:local
```

### 3. 持续监控日志（后台运行）

```bash
docker logs -f stt-to-notion-local
```

用 `run_in_background: true` 启动，之后定期用 `docker logs --tail 20 stt-to-notion-local` 轮询，不要用短 sleep 死等。流水线一次完整耗时通常在 100~150 秒（ASR 转写约 50~60s，AI 整理约 40~60s，Notion 写入几秒）。

### 4. 上传测试音频

先问用户录音文件路径，注意文件名可能含空格或中文，要加引号：

```bash
curl -s -X POST http://localhost:3000/voice-memo -F "file=@<用户提供的路径>"
```

接口会立即返回 `202` 和 `taskId`，实际处理在后台异步进行，需要靠日志确认结果，不能只看这个响应。

### 5. 判断流水线完成

日志里按顺序出现：
- `[1/5] 上传 OSS 完成`
- `[2/5] 提交转写任务完成`
- 若干次 `轮询 #N status=RUNNING`，直到 `status=SUCCEEDED`
- `[3/5] 转写完成`
- `可选分类（来自 Notion）=...`，内容应与 Notion 数据库里「分类」属性的当前选项一致
- `[4/5] AI 整理完成`，附带 `page_id` 会在下一行的 Notion 创建日志中出现
- `Notion 页面创建成功 page_id=...`
- `[5/5] 写入 Notion 完成`
- `流水线全部完成 总耗时=...`

如果超过 5 分钟仍卡在某一步没有推进，应向用户报告可能异常，不要无限等待。

### 6. 用 Notion MCP 检查页面

拿到日志里的 `page_id` 后：

```
mcp__<notion-mcp>__notion-fetch  id: <page_id>
```

正常情况下应该是：
- 标题/摘要/分类/标签等 properties 与转写内容对应，没有空值或明显错误
- Markdown 被正确转换成 Notion 原生块，而不是原始符号：
  - `#`/`##`/`###` 变成 heading，而不是文本里带着 `#`
  - `-`/`*` 开头的行变成列表项
  - `**加粗**` 变成真正的粗体富文本，而不是字面上的 `**` 符号。用 notion-fetch 返回结果判断：显示为转义的 `\*\*文本\*\*` 说明只是字面字符没有渲染成粗体；显示为不带反斜杠的 `**文本**` 说明是真实的 bold 富文本（fetch 工具会把真实富文本重新序列化成不转义的 markdown）
- "原文" 折叠板块存在，展开后是转写全文，而不是被截断或缺失

### 7. 清理

测试完成后清理本地容器，避免占用 3000 端口：

```bash
docker rm -f stt-to-notion-local
```

## 常见坑

- `docker-compose.yml` 里配置的是远程镜像（阿里云 ACR），`docker compose up` 不会用到本地改动，必须走上面手动 `docker build` + `docker run` 的本地镜像流程
- 音频文件较大时（20MB+）ASR 转写轮询采用指数退避（`POLL_INITIAL_DELAY_MS` / `POLL_BACKOFF_FACTOR`），间隔会越来越长，属正常现象
- 上传接口是 202 立即返回，真正的处理结果只能通过日志或 Notion 页面确认，curl 的响应体不代表任务成功
