/**
 * 群星日程 · 图像生成代理（Vercel Serverless Function，Edge Runtime）
 *
 * 可选路径：默认人物画像走免费免 Key 的 pollinations.ai（浏览器直连，零配置），
 * 只有前端设置了 VITE_IMAGE_BASE_URL 才会调用本函数。
 *   浏览器 → POST /api/image（经 vercel.json rewrite 自 /api/image/images/generations）
 *         → 本函数 → 上游 OpenAI 兼容图像 API
 *
 * 与 api/chat.ts、workers/llm-proxy/src/index.ts 的加固规则同步维护：
 *  - 请求体 ≤ 8KB；prompt ≤ 1000 字符
 *  - 字段白名单：仅转发 model/prompt/size/response_format/n/quality/style，
 *    且 model 被强制替换为 IMAGE_MODEL
 *  - 限流：每 IP 每天 10 次（模块级 Map，单实例内存 best-effort；
 *    精确限流可换 Upstash Redis，见 api/chat.ts 文件头注释）
 *  - 不记录任何密钥；错误响应不含内部细节
 *
 * 环境变量（Vercel Dashboard → Project → Settings → Environment Variables）：
 *  - IMAGE_API_KEY    图像 API Key（只存服务端）；未配置 → 501，
 *                     提示客户端改用免费默认 provider（pollinations.ai）
 *  - IMAGE_BASE_URL   可选，默认 https://api.openai.com/v1
 *  - IMAGE_MODEL      可选，默认 dall-e-3（强制用于每个请求）
 *  - ALLOWED_ORIGINS  可选，逗号分隔的 Origin 白名单（与 api/chat.ts 共用）
 */

export const config = { runtime: 'edge' };

// Edge Runtime 无 @types/node 依赖，最小声明 Vercel 注入的 process.env
declare const process: { env: Record<string, string | undefined> };

const MAX_BODY_BYTES = 8 * 1024;
const MAX_PROMPT_CHARS = 1000;
const DAILY_IMAGE_LIMIT_PER_IP = 10;
/** 允许转发给上游的字段白名单 */
const ALLOWED_FIELDS = new Set([
  'model',
  'prompt',
  'size',
  'response_format',
  'n',
  'quality',
  'style',
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

/** 与 api/chat.ts 一致：ALLOWED_ORIGINS 未设置 → 不校验；设置后 Origin 必须在白名单内 */
function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const list = env('ALLOWED_ORIGINS');
  if (!list) return origin;
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

// 单实例内存限流（best-effort），与 chat 函数相互独立计数
const memoryCounters = new Map<string, { date: string; count: number }>();

function hitRateLimit(ip: string): boolean {
  const date = todayKey();
  const entry = memoryCounters.get(ip);
  if (!entry || entry.date !== date) {
    memoryCounters.set(ip, { date, count: 1 });
    return false;
  }
  if (entry.count >= DAILY_IMAGE_LIMIT_PER_IP) return true;
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

  // 未配置图像 API：提示开发者改用免费默认 provider（前端默认不走这里）
  const apiKey = env('IMAGE_API_KEY');
  if (!apiKey) {
    return jsonError(
      501,
      'Image API not configured: set IMAGE_API_KEY, or use the free default provider (pollinations.ai) which needs no config',
      origin,
    );
  }
  const upstreamBase = env('IMAGE_BASE_URL') || 'https://api.openai.com/v1';
  const upstreamModel = env('IMAGE_MODEL') || 'dall-e-3';

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
  const prompt = body.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return jsonError(400, 'prompt is required', origin);
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return jsonError(400, 'prompt too long', origin);
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
    return jsonError(429, 'Rate limit exceeded: 10 image requests/day per IP', origin);
  }

  // 转发上游（密钥只存在于服务端环境，绝不落地日志）
  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase.replace(/\/$/, '')}/images/generations`, {
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
