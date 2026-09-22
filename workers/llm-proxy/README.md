# 群星日程 · LLM 代理 Worker

把真实的大模型 API Key 留在 Cloudflare 服务端，浏览器（及本仓库）永远不接触密钥。
免费额度（Workers Free：10 万次请求/天）对本应用绰绰有余。

```
浏览器 ──POST /v1/chat/completions──▶ 本 Worker ──▶ 上游大模型（Moonshot / DeepSeek / OpenAI…）
        （不携带真实 Key）              （Worker secrets 中的 Key 鉴权）
浏览器 ──POST /v1/images/generations─▶ 本 Worker ──▶ 上游图像 API（可选，见下文）
浏览器 ──GET|POST /v1/quotes────────▶ 本 Worker ──▶ cn.bing.com 国内互联网检索（服务端发起）
```

## 语录检索代理（/v1/quotes）

语录来源为国内互联网检索（cn.bing.com）：必应结果页无 CORS 头，浏览器无法直连，
因此语录检索统一经本路由在服务端完成（前端无浏览器直连回退）。cn.bing.com 国内
直连与 Worker 边缘节点均可达，不再依赖被 GFW 封锁的维基语录。

- 输入：`POST {"candidates": ["梵高", "文森特·梵高"]}` 或 `{"person": "梵高"}`（GET 对应
  `?candidates=a,b` / `?person=x`）；候选名 ≤6 个、每个 ≤50 字符
- 输出：`{ quotes: [{text, source}], usedName, source: "bing" }`；找不到返回 404 `{"error":"not_found"}`
- 算法共享自 `shared/websearch.ts`（候选名按序尝试 ×「经典语录/名句/名言」查询词、
  解析结果页摘要、相关性闸门过滤降级页），与 Vercel `api/quotes.ts` 同源
- 限流：每 IP 每天 30 次（与 chat/image 独立计数）；`BING_BASE` var 可覆盖检索站点地址

## 安全特性

- **CORS 白名单**：仅 `ALLOWED_ORIGINS` 中的来源可调用，其余 403
- **请求加固**：请求体 ≤ 8KB；messages 文本总量 ≤ 4000 字符；仅转发
  `model/messages/temperature/max_tokens/response_format` 五个字段；`model` 被强制替换为 `UPSTREAM_MODEL`
- **限流**：每 IP 每天 10 次（应用侧另有 3 次成功生成/天的限额；一次生成 = 2 次 LLM 调用）
- **不记录密钥**；上游错误对客户端只返回通用 502

## 可选：图像生成代理（/v1/images/generations）

**默认不需要**：AI 生成主题的人物画像默认走免费、免 Key、CORS 开放的
[pollinations.ai](https://pollinations.ai)（浏览器直连，零配置）。
只有在前端设置了 `VITE_IMAGE_BASE_URL` 指向本 Worker 时，才需要配置图像上游：

```bash
wrangler secret put IMAGE_API_KEY     # 图像 API 的 Key
# wrangler.toml [vars] 中可选：IMAGE_BASE_URL（默认 https://api.openai.com/v1）、
# IMAGE_MODEL（默认 dall-e-3，强制用于每个请求）
```

图像路由的加固与 chat 一致：请求体 ≤ 8KB、prompt ≤ 1000 字符、字段白名单
（`model/prompt/size/response_format/n/quality/style`）、强制模型、
每 IP 每天 10 次（与 chat 独立计数）。未配置 `IMAGE_API_KEY` 时返回 501，
提示客户端改用免费默认 provider。

## 部署步骤

```bash
npm i -g wrangler        # 或只用本目录 devDependencies 里的 wrangler
wrangler login           # 浏览器授权 Cloudflare 账号（免费注册即可）

cd workers/llm-proxy
npm install

# 1. 设置上游密钥（密钥不会写入任何文件）
wrangler secret put UPSTREAM_API_KEY
# 提示输入时粘贴你的 Key

# 2. 编辑 wrangler.toml 的 [vars]：
#    UPSTREAM_BASE_URL  上游接口（默认 https://api.moonshot.cn/v1）
#    UPSTREAM_MODEL     强制使用的模型（默认 moonshot-v1-8k）
#    ALLOWED_ORIGINS    加上你的 Pages 域名，如 https://<user>.github.io

# 3. 部署
wrangler deploy
# 输出类似 https://qunxing-llm-proxy.<your-subdomain>.workers.dev
```

把该 URL 配到前端（仓库 Variable `VITE_PROXY_URL` 或 `.env.local`），
访问者即可零配置使用 AI 生成。

## 获取上游 API Key

- **Moonshot（Kimi）**：<https://platform.moonshot.cn> → API Key 管理（国内可直连，推荐）
- **DeepSeek**：<https://platform.deepseek.com> → API Keys
- **OpenAI**：<https://platform.openai.com/api-keys>

对应修改 `wrangler.toml` 的 `UPSTREAM_BASE_URL` / `UPSTREAM_MODEL` 即可
（DeepSeek：`https://api.deepseek.com/v1` + `deepseek-chat`；OpenAI：`https://api.openai.com/v1` + `gpt-4o-mini`）。

## 限流说明

- 默认（不绑 KV）：单 isolate 内存计数，**best-effort**——Worker 多实例时各实例独立计数，
  实际限额可能略高于 10 次/天/IP；实例回收后计数清零。
- 精确限流：`wrangler kv namespace create RATE_LIMIT_KV`，把返回的 id 填入
  `wrangler.toml` 的 `[[kv_namespaces]]` 并取消注释，重新 `wrangler deploy`。

## 本地开发

```bash
npm install
echo 'UPSTREAM_API_KEY=sk-...' > .dev.vars   # 本地密钥（.gitignore 已忽略）
npm run dev                                   # http://127.0.0.1:8787
npm run typecheck                             # TS 类型检查
```
