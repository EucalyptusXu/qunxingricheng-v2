/**
 * 群星日程 · LLM 代理（Vercel Serverless Function，Edge Runtime）
 *
 * 职责：把真实的大模型 API Key 留在服务端，浏览器永远接触不到密钥。
 *   浏览器 → POST /api/chat（同源，经 vercel.json rewrite 自 /api/chat/completions）
 *         → 本函数 → 上游大模型厂商
 *
 * 与 workers/llm-proxy/src/index.ts（Cloudflare Worker）逻辑保持一致，
 * 两处加固规则需同步维护：
 *  - 请求体 ≤ 8KB；messages 文本总量 ≤ 4000 字符
 *  - 字段白名单：仅转发 model/messages/temperature/max_tokens/response_format，
 *    且 model 被强制替换为 UPSTREAM_MODEL
 *  - 限流：每 IP 每天 10 次（一次主题生成 = 2 次调用，应用侧另有 3 次/天限额）
 *  - 不记录任何密钥；错误响应不含内部细节
 *
 * 环境变量（Vercel Dashboard → Project → Settings → Environment Variables）：
 *  - UPSTREAM_API_KEY   必需，上游 API Key（只存服务端，绝不进仓库）
 *  - UPSTREAM_BASE_URL  可选，默认 https://api.deepseek.com/v1
 *  - UPSTREAM_MODEL     可选，默认 deepseek-chat（强制用于每个请求）
 *  - ALLOWED_ORIGINS    可选，逗号分隔的 Origin 白名单；
 *                       同源部署下 CORS 基本无意义，留空则不校验
 *
 * 限流说明：模块级 Map 存于单个 serverless 实例内存，实例扩缩/回收后计数重置，
 * 属于 best-effort。需要精确全局限流可换 Upstash Redis REST：
 *   const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/incr/${key}`,
 *     { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
 * 本演示项目的免费额度与前端 3 次/天限额下，内存限流已足够。
 */

export const config = { runtime: 'edge' };

// Edge Runtime 无 @types/node 依赖，最小声明 Vercel 注入的 process.env
declare const process: { env: Record<string, string | undefined> };

const MAX_BODY_BYTES = 8 * 1024;
const MAX_MESSAGES_CHARS = 4000;
const DAILY_LIMIT_PER_IP = 10;
/** 允许转发给上游的字段白名单 */
const ALLOWED_FIELDS = new Set([
  'model',
  'messages',
  'temperature',
  'max_tokens',
  'response_format',
]);

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function jsonError(status: number, message: string, origin: string | null): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

function corsHeaders(origin: string | null): Record<string, string> {
  return origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : {};
}

/**
 * Origin 校验：ALLOWED_ORIGINS 未设置 → 不校验（同源部署的默认形态）；
 * 设置后，带 Origin 头的请求必须在白名单内，否则 403。
 * 返回可放行的 Origin（用于回写 CORS 头），null 表示不放行/无 Origin。
 */
function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null; // 非浏览器请求（如 curl）：不做 CORS 放行但也不拦截
  const list = env('ALLOWED_ORIGINS');
  if (!list) return origin; // 未配置白名单：同源场景，直接放行
  const allowed = list
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

/* --------------------------------- 限流 --------------------------------- */

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // UTC 日期
}

// 单实例内存限流（best-effort）：serverless 多实例各自独立计数，
// 实际限额会略高于标称值；需要精确限流请换 Upstash Redis（见文件头注释）。
const memoryCounters = new Map<string, { date: string; count: number }>();

function hitRateLimit(ip: string): boolean {
  const date = todayKey();
  const entry = memoryCounters.get(ip);
  if (!entry || entry.date !== date) {
    memoryCounters.set(ip, { date, count: 1 });
    return false;
  }
  if (entry.count >= DAILY_LIMIT_PER_IP) return true;
  entry.count += 1;
  return false;
}

/* --------------------------------- 主入口 --------------------------------- */

export default async function handler(request: Request): Promise<Response> {
  const origin = allowedOrigin(request);

  // CORS 预检
  if (request.method === 'OPTIONS') {
    if (request.headers.get('Origin') && !origin) {
      return jsonError(403, 'Origin not allowed', null);
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return jsonError(405, 'Method not allowed', origin);
  }
  if (request.headers.get('Origin') && !origin) {
    return jsonError(403, 'Origin not allowed', null);
  }

  // 服务端密钥（Vercel 环境变量）；未配置属于部署错误
  const apiKey = env('UPSTREAM_API_KEY');
  if (!apiKey) {
    return jsonError(500, 'Server misconfigured: UPSTREAM_API_KEY is not set', origin);
  }
  const upstreamBase = env('UPSTREAM_BASE_URL') || 'https://api.deepseek.com/v1';
  const upstreamModel = env('UPSTREAM_MODEL') || 'deepseek-chat';

  // 请求体大小上限
  const contentLength = Number(request.headers.get('Content-Length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return jsonError(413, 'Request body too large', origin);
  }
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonError(413, 'Request body too large', origin);
  }

  // 字段白名单 + 强制模型
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'Invalid JSON', origin);
  }
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(400, 'messages is required', origin);
  }
  const totalChars = messages.reduce((sum: number, m) => {
    const content = (m as { content?: unknown })?.content;
    return sum + (typeof content === 'string' ? content.length : 0);
  }, 0);
  if (totalChars > MAX_MESSAGES_CHARS) {
    return jsonError(400, 'messages too long', origin);
  }
  const forwarded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(key)) forwarded[key] = value;
  }
  forwarded.model = upstreamModel; // 强制模型，忽略客户端传入

  // 限流（每 IP 每天 10 次；Vercel 经 x-forwarded-for 传递真实 IP）
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';
  if (hitRateLimit(ip)) {
    return jsonError(429, 'Rate limit exceeded: 10 requests/day per IP', origin);
  }

  // 转发上游（密钥只存在于服务端环境，绝不落地日志）
  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(forwarded),
    });
  } catch {
    return jsonError(502, 'Upstream request failed', origin);
  }

  const payload = await upstream.text();
  if (!upstream.ok) {
    // 不向上游之外泄露细节
    return jsonError(502, 'Upstream returned an error', origin);
  }
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
