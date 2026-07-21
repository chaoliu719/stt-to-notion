# stt-to-notion

把手机上的一段录音，自动变成 Notion 里一篇带标题、摘要、分类、标签和转写原文的笔记。

录完音，在系统分享菜单里点一下快捷指令，剩下的全自动。等几分钟，Notion 里就有了。

```
语音备忘录 ──分享──▶ iOS 快捷指令 ──POST──▶ 你的服务器
                                              │
                                              ├─▶ 阿里云 OSS（存音频，生成签名 URL）
                                              ├─▶ DashScope FunASR（语音转文字）
                                              ├─▶ DashScope Qwen（生成标题/摘要/分类/标签，并规整原文）
                                              └─▶ Notion（新建一页笔记）
```

## 花多少钱

作者实测：**约 2 小时录音，一共花了 ¥0.15**，转写和大模型的账单都是几厘几厘地扣。

DashScope 新用户还有相当可观的免费额度，日常用量基本上是白嫖。真正的固定成本是那台服务器 —— 但它必须是公网可访问的，否则手机在外面发不进来。

## 你需要准备什么

这个项目是**自部署**的，所有云服务都用你自己的账号，数据只经过你自己的服务器和存储桶。开始前先备齐这四样：

### 1. 阿里云 OSS 存储桶

用来存原始音频，并给转写服务提供一个临时可下载的地址。

- 新建一个 Bucket，**读写权限保持「私有」即可** —— 代码用的是有效期 1 小时的签名 URL（[src/oss.ts:27](src/oss.ts:27)），不需要把桶设成公共读。
- 建议**和你的服务器选同一个地域**。这样可以打开 `OSS_INTERNAL=true`，上传走内网：更快，而且不计流量费（[src/oss.ts:14](src/oss.ts:14)）。
- 创建一个 AccessKey，拿到 `AccessKey ID` 和 `AccessKey Secret`。

### 2. 阿里云百炼（DashScope）API Key

同时用于两件事：

- **语音转写**：`fun-asr` 模型，异步任务 + 轮询（[src/funasr.ts](src/funasr.ts)）。
- **内容整理**：`qwen-plus` 模型，走 OpenAI 兼容接口（[src/ai.ts:8](src/ai.ts:8)）。

在百炼控制台开通服务并创建 API Key 即可，两个模型共用同一个 Key。

### 3. Notion Integration + 数据库

1. 到 [Notion Integrations](https://www.notion.so/my-integrations) 新建一个 Internal Integration，拿到 `Internal Integration Secret`，就是 `NOTION_TOKEN`。
2. 复制模板数据库到你自己的空间：**[录音笔记模板](https://chaoliu719.notion.site/cde4a7bdd5204aaa8084f531f409963f?v=858e252b02bc481487db8172812b41f7)** —— 打开后点右上角的「复制」（Duplicate）即可。

   也可以自己手动建，属性名和类型必须**完全一致**，否则写入会失败：

   | 属性名 | 类型 | 说明 |
   |---|---|---|
   | 标题 | Title | AI 生成的一句话标题 |
   | 摘要 | Text | AI 生成的 2–3 句摘要 |
   | 分类 | Select | 模板预设了 想法 / 任务 / 记录 / 灵感，**可以随意增删** |
   | 标签 | Multi-select | AI 自由生成，不需要预设选项 |
   | 源文件 | Text | 音频在 OSS 里的文件名，方便回溯 |

   属性名是中文，来自 [src/note-schema.ts:15](src/note-schema.ts:15)。**属性名和类型**对不上就会写入失败。

   「分类」的选项由你说了算：服务每次处理录音前会先读一遍 Notion 里这个 Select 的当前选项，再让 AI 从中挑一个（[src/notion.ts:19](src/notion.ts:19)）。你在 Notion 里加一个「播客」、删掉一个「灵感」，下一条录音立刻生效，**不用改代码，也不用重新部署**。

3. **把数据库授权给这个 Integration**：打开数据库页面 → 右上角 `···` → `连接`（Connections）→ 选中你刚创建的 Integration。

   > 这一步最容易漏。漏了的话 token 是对的、database id 也是对的，但每次写入都会 404。

4. 取 `NOTION_DATABASE_ID`：打开数据库页面，地址栏形如
   `https://www.notion.so/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=yyyy`，
   问号前面那段 32 位字符就是 database id。

### 4. 一台公网服务器

任意能装 Docker 的云主机都行，1 核 2G 足够。快捷指令要能从外网访问到它，所以需要公网 IP 或域名。

## 部署

### 配置环境变量

```bash
git clone https://github.com/chaoliu719/stt-to-notion.git
cd stt-to-notion
cp .env.example .env
```

编辑 `.env`：

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `PORT` | 否 | `3000` | 服务监听端口 |
| `LOG_LEVEL` | 否 | `info` | `debug` / `info` / `warn` / `error`；排查问题时设为 `debug`，会打印 AI 的完整返回 |
| `OSS_ACCESS_KEY_ID` | **是** | — | 阿里云 AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | **是** | — | 阿里云 AccessKey Secret |
| `OSS_BUCKET` | **是** | — | 存储桶名称 |
| `OSS_REGION` | 否 | `oss-cn-hangzhou` | 存储桶所在地域，格式如 `oss-cn-shanghai` |
| `OSS_INTERNAL` | 否 | `false` | 服务器与存储桶同地域时设为 `true`，上传走内网；本地开发必须保持 `false` |
| `DASHSCOPE_API_KEY` | **是** | — | 百炼 API Key |
| `DASHSCOPE_ASR_BASE_URL` | 否 | `https://dashscope.aliyuncs.com` | 一般不用改 |
| `DASHSCOPE_LLM_BASE_URL` | 否 | `https://dashscope.aliyuncs.com` | 一般不用改 |
| `ASR_MODEL` | 否 | `fun-asr` | 转写模型 |
| `LLM_MODEL` | 否 | `qwen-plus` | 整理笔记的模型，可换成别的 Qwen 型号 |
| `NOTION_TOKEN` | **是** | — | Integration Secret |
| `NOTION_DATABASE_ID` | **是** | — | 目标数据库 id（32 位） |
| `POLL_INITIAL_DELAY_MS` | 否 | `5000` | 转写结果首次轮询前等待的毫秒数 |
| `POLL_MAX_ATTEMPTS` | 否 | `30` | 最多轮询多少次，超过就判定超时 |
| `POLL_BACKOFF_FACTOR` | 否 | `1.4` | 轮询间隔的退避倍数，录音越长间隔涨得越有用 |

四项标「是」的凭证缺任何一个，服务会在启动时直接报 `Missing env var: XXX` 退出（[src/config.ts:1](src/config.ts:1)）。

### 启动

```bash
docker build -t stt-to-notion .

docker run -d --name stt-to-notion --restart always \
  -p 3000:3000 \
  --env-file .env \
  stt-to-notion
```

建议在前面挂一层 Nginx / Caddy 做反向代理并配好 HTTPS，快捷指令用起来更省心；直接用 `http://你的IP:3000` 也能跑通。

## 先验证服务器，再配快捷指令

**顺序不要反。** 先用 curl 确认服务器这条链路是通的，再把地址填进快捷指令 —— 否则快捷指令报错时，你分不清是手机的问题还是服务端的问题。

### 第一步：健康检查

```bash
curl https://你的地址/health
# 期望输出：{"ok":true}
```

### 第二步：上传一段测试音频

```bash
curl -X POST https://你的地址/voice-memo -F "file=@test.m4a"
# 期望输出：{"success":true,"taskId":"..."}，HTTP 状态码 202
```

> ⚠️ **202 只代表音频上传成功，不代表整条流水线成功。** 转写、AI 整理、写 Notion 都是后台异步跑的（[src/index.ts:74](src/index.ts:74)），结果只能靠日志和 Notion 页面确认。

### 第三步：跟着日志看完整条流水线

```bash
docker logs -f stt-to-notion
```

正常会依次出现：

```
[1/5] 上传 OSS 完成
[2/5] 提交转写任务完成
轮询 #1 status=RUNNING ...      ← 会重复若干次，间隔逐次变长，属正常
[3/5] 转写完成
可选分类（来自 Notion）=想法/任务/记录/灵感
[4/5] AI 整理完成
Notion 页面创建成功 page_id=...
[5/5] 写入 Notion 完成
流水线全部完成 总耗时=...
```

一段几分钟的录音，全程通常 100~150 秒。跑完去 Notion 数据库里看，应该多出一页新笔记：属性都填好了，正文是 AI 整理过的内容，底部有一个可折叠的「原文」板块存放转写全文。

到这一步都正常，才继续往下。

### 第四步：安装并配置快捷指令

1. 在 iPhone 上安装快捷指令：<https://www.icloud.com/shortcuts/04c70dc0b4a34af3a449c77a6a327270>
2. 安装后打开它进行编辑，找到「获取 URL 内容」这一步，把里面的地址改成**你自己的、上面刚验证过的**服务器地址，即 `https://你的地址/voice-memo`。其他参数都不用动。
3. 打开语音备忘录 → 选中一段录音 → 分享 → 选择这个快捷指令。

如果你想自己搭一个快捷指令，只需要三步：接收分享进来的音频文件 → 「获取 URL 内容」，方法选 `POST`、请求体选 `表单`、添加一个类型为「文件」的字段 → **字段名必须叫 `file`**（[src/index.ts:60](src/index.ts:60)），值选上一步的音频。

## 自定义

**改分类，直接在 Notion 里改。** 打开数据库，编辑「分类」这个 Select 的选项，加也好删也好，下一条录音就按新的来 —— 不用碰代码，不用重新部署。

其余的想调，改 [src/note-schema.ts](src/note-schema.ts)：

- **提示词**：`buildSystemPrompt`（[src/note-schema.ts:23](src/note-schema.ts:23)）。摘要多长、正文怎么组织，都在这里说。
- **Notion 属性名**：`NOTION_PROPERTIES`（[src/note-schema.ts:15](src/note-schema.ts:15)）。想用英文属性名或者改叫别的，改这里，同时改 Notion 数据库。
- **兜底分类**：`DEFAULT_CATEGORY_OPTIONS`（[src/note-schema.ts:3](src/note-schema.ts:3)）。只有在读不到 Notion 分类选项时（网络异常、属性被删空）才会用到。

这两项改完要重新 `docker build` 并重启容器。

## 自动部署（可选）

仓库里的 [.github/workflows/deploy.yml](.github/workflows/deploy.yml) 是作者自己在用的一条流水线：push 到 `main` → 构建镜像推到阿里云 ACR → SSH 到 ECS 上拉取并重启。

**它不会开箱即用**，因为里面的地址和凭证全部来自 GitHub Secrets。你 fork 之后有两个选择：

- **不用 CI**：直接删掉这个 workflow，按上面「部署」一节手动跑就行。
- **要用 CI**：在仓库的 `Settings → Secrets and variables → Actions` 里配齐这 8 个 Secret（换成你自己的镜像仓库和服务器）：

  | Secret | 说明 |
  |---|---|
  | `ACR_REGISTRY` | 镜像仓库地址，如 `registry.cn-hangzhou.aliyuncs.com` |
  | `ACR_NAMESPACE` | 镜像仓库命名空间 |
  | `ACR_USERNAME` | 镜像仓库用户名 |
  | `ACR_PASSWORD` | 镜像仓库密码 |
  | `ECS_HOST` | 服务器地址 |
  | `ECS_USER` | SSH 用户名 |
  | `ECS_SSH_KEY` | SSH 私钥 |
  | `ECS_DEPLOY_PATH` | 服务器上的部署目录 |

  另外要在服务器的 `ECS_DEPLOY_PATH` 目录下放好 [docker-compose.yml](docker-compose.yml) 和填好的 `.env`。compose 里的 `${STT_IMAGE}` 由 workflow 在 SSH 会话里 export（[deploy.yml:43](.github/workflows/deploy.yml:43)），你不需要手写。

## 已知限制

- **失败是静默的。** 流水线任意一步出错，只会记在服务器日志里（[src/index.ts:48](src/index.ts:48)），Notion 里不会有任何提示 —— 表现就是「等了半天没出现」。遇到这种情况去看 `docker logs`。
- **入口只有 iOS 快捷指令。** 服务端就是一个普通的 multipart 上传接口，安卓、脚本、其他自动化工具都能接，只是仓库里没有现成的。
- **输出只支持 Notion。**

## 参与开发

- 开发流程和提交规范见 [CLAUDE.md](CLAUDE.md)
- 改完代码怎么本地跑一遍完整流水线，见 [TESTING.md](TESTING.md)

```bash
npm install
npm run dev     # tsx watch，热重载
npm run build   # 编译到 dist/
```

## License

[MIT](LICENSE)
