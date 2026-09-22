/**
 * 群星日程 · LLM 代理 Worker
 *
 * 职责：把真实的大模型 API Key 留在服务端，浏览器永远接触不到密钥。
 *   浏览器 → POST /v1/chat/completions → 本 Worker → 上游大模型厂商
 *   浏览器 → POST /v1/images/generations → 本 Worker → 上游图像 API（可选；
 *           默认人物画像走免费免 Key 的 pollinations.ai，无需本路由）
 *   浏览器 → GET|POST /v1/quotes → 本 Worker → cn.bing.com 国内互联网检索
 *           （无 CORS 浏览器无法直连，故检索移到服务端；边缘节点可达）
 *
 * 安全加固：
 *  - CORS 仅放行 ALLOWED_ORIGINS 中的来源（其余 403）
 *  - 请求体 ≤ 8KB；messages 文本总量 ≤ 4000 字符
 *  - 字段白名单：仅转发 model/messages/temperature/max_tokens/response_format，
 *    且 model 被强制替换为 UPSTREAM_MODEL
 *  - 限流：每 IP 每天 10 次（一次主题生成 = 2 次调用，应用侧另有 3 次/天限额）；
 *    绑定 RATE_LIMIT_KV 时全局限流，否则单 isolate 内存限流（best-effort）
 *  - 不记录任何密钥；错误响应不含内部细节
 */

import { searchQuotesViaBing } from '../../../shared/websearch';

export interface Env {
  /** 上游 OpenAI 兼容接口地址（var） */
  UPSTREAM_BASE_URL: string;
  /** 上游 API Key（secret，wrangler secret put 设置） */
  UPSTREAM_API_KEY: string;
  /** 强制使用的模型（var） */
  UPSTREAM_MODEL: string;
  /** 允许的来源，逗号分隔（var） */
  ALLOWED_ORIGINS: string;
  /** 可选 KV 命名空间：全局 IP 限流 */
  RATE_LIMIT_KV?: KVNamespace;
  /** 可选：图像生成上游地址（var，默认 https://api.openai.com/v1） */
  IMAGE_BASE_URL?: string;
  /** 可选：图像 API Key（secret）；未配置时 /v1/images/generations 返回 501 */
  IMAGE_API_KEY?: string;
  /** 可选：强制使用的图像模型（var，默认 dall-e-3） */
  IMAGE_MODEL?: string;
  /** 可选：检索站点覆盖（var，默认 https://cn.bing.com） */
  BING_BASE?: string;
}

const MAX_BODY_BYTES = 8 * 1024;
const MAX_MESSAGES_CHARS = 4000;
const MAX_PROMPT_CHARS = 1000;
const DAILY_LIMIT_PER_IP = 10;
/** 语录检索限流（每 IP 每天；检索便宜但防滥用） */
const DAILY_QUOTES_LIMIT_PER_IP = 30;
const MAX_QUOTE_CANDIDATES = 6;
const MAX_QUOTE_NAME_CHARS = 50;
/** 允许转发给上游的字段白名单（chat completions） */
const ALLOWED_FIELDS = new Set([
  'model',
  'messages',
  'temperature',
  'max_tokens',
  'response_format',
]);
/** 允许转发给上游的字段白名单（images generations） */
const ALLOWED_IMAGE_FIELDS = new Set([
  'model',
  'prompt',
  'size',
  'response_format',
  'n',
  'quality',
  'style',
]);

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

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null; // 非浏览器请求（如 curl）：不做 CORS 放行但也不拦截
  const allowed = env.ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

/* --------------------------------- 限流 --------------------------------- */

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // UTC 日期
}

// 单 isolate 内存限流（best-effort）：Worker 可能有多个 isolate，
// 每个 isolate 独立计数，实际限额会略高于标称值；需要精确限流请绑定 RATE_LIMIT_KV。
// chat 与 image 两条业务线独立计数（scope 前缀区分）。
const memoryCounters = new Map<string, { date: string; count: number }>();

async function hitRateLimit(
  ip: string,
  env: Env,
  scope: 'chat' | 'image' | 'quotes',
  limit: number = DAILY_LIMIT_PER_IP,
): Promise<boolean> {
  const date = todayKey();
  if (env.RATE_LIMIT_KV) {
    const key = `rl:${scope}:${date}:${ip}`;
    const current = Number((await env.RATE_LIMIT_KV.get(key)) ?? '0');
    if (current >= limit) return true;
    await env.RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: 86400 });
    return false;
  }
  const memKey = `${scope}:${ip}`;
  const entry = memoryCounters.get(memKey);
  if (!entry || entry.date !== date) {
    memoryCounters.set(memKey, { date, count: 1 });
    return false;
  }
  if (entry.count >= limit) return true;
  entry.count += 1;
  return false;
}

/* --------------------------------- 主入口 --------------------------------- */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request, env);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      if (request.headers.get('Origin') && !origin) {
        return jsonError(403, 'Origin not allowed', null);
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // 路由：POST /v1/chat/completions、POST /v1/images/generations、GET|POST /v1/quotes
    const url = new URL(request.url);
    if (url.pathname === '/v1/quotes') {
      return handleQuotes(request, env, origin);
    }
    if (request.method !== 'POST') {
      return jsonError(404, 'Not found', origin);
    }
    if (url.pathname === '/v1/images/generations') {
      return handleImageGenerations(request, env, origin);
    }
    if (url.pathname !== '/v1/chat/completions') {
      return jsonError(404, 'Not found', origin);
    }
    if (request.headers.get('Origin') && !origin) {
      return jsonError(403, 'Origin not allowed', null);
    }

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
    forwarded.model = env.UPSTREAM_MODEL; // 强制模型，忽略客户端传入

    // 限流（每 IP 每天 10 次）
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (await hitRateLimit(ip, env, 'chat')) {
      return jsonError(429, 'Rate limit exceeded: 10 requests/day per IP', origin);
    }

    // 转发上游（密钥只存在于 Worker 环境，绝不落地日志）
    let upstream: Response;
    try {
      upstream = await fetch(
        `${env.UPSTREAM_BASE_URL.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.UPSTREAM_API_KEY}`,
          },
          body: JSON.stringify(forwarded),
        },
      );
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
  },
};

/* --------------------------- /v1/images/generations --------------------------- */

/**
 * 可选的图像生成代理（与 api/image.ts 逻辑同步维护）。
 * 默认人物画像走免费免 Key 的 pollinations.ai（浏览器直连），
 * 只有前端设置了 VITE_IMAGE_BASE_URL 才会调用本路由；
 * 未配置 IMAGE_API_KEY 时返回 501，提示改用免费默认 provider。
 */
async function handleImageGenerations(
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  if (request.headers.get('Origin') && !origin) {
    return jsonError(403, 'Origin not allowed', null);
  }

  const apiKey = env.IMAGE_API_KEY?.trim();
  if (!apiKey) {
    return jsonError(
      501,
      'Image API not configured: set IMAGE_API_KEY, or use the free default provider (pollinations.ai) which needs no config',
      origin,
    );
  }
  const upstreamBase = env.IMAGE_BASE_URL?.trim() || 'https://api.openai.com/v1';
  const upstreamModel = env.IMAGE_MODEL?.trim() || 'dall-e-3';

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
    if (ALLOWED_IMAGE_FIELDS.has(key)) forwarded[key] = value;
  }
  forwarded.model = upstreamModel; // 强制模型，忽略客户端传入

  // 限流（每 IP 每天 10 次，与 chat 独立计数）
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (await hitRateLimit(ip, env, 'image')) {
    return jsonError(429, 'Rate limit exceeded: 10 image requests/day per IP', origin);
  }

  // 转发上游（密钥只存在于 Worker 环境，绝不落地日志）
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

/* --------------------------------- /v1/quotes --------------------------------- */

/**
 * 国内互联网语录检索代理（与 api/quotes.ts 逻辑同步维护）。
 * 为什么需要它：cn.bing.com 无 CORS，浏览器无法直连；检索移到服务端，
 * 国内访客与 Worker 边缘节点访问 cn.bing.com 均畅通。
 * 检索算法共享自 shared/websearch.ts（与 Vercel 函数同源）。
 */
async function handleQuotes(
  request: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonError(405, 'Method not allowed', origin);
  }
  if (request.headers.get('Origin') && !origin) {
    return jsonError(403, 'Origin not allowed', null);
  }

  // 输入解析：GET ?candidates=a,b / ?person=x 或 POST JSON {candidates:[...]} / {person:"x"}
  let raw: unknown[] | null = null;
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const joined = url.searchParams.get('candidates');
    const single = url.searchParams.get('person');
    if (joined) raw = joined.split(',');
    else if (single) raw = [single];
  } else {
    const contentLength = Number(request.headers.get('Content-Length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) {
      return jsonError(413, 'Request body too large', origin);
    }
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (Array.isArray(body.candidates)) raw = body.candidates;
      else if (typeof body.person === 'string') raw = [body.person];
    } catch {
      return jsonError(400, 'Invalid JSON', origin);
    }
  }
  if (!raw || raw.length === 0) {
    return jsonError(400, 'candidates or person is required', origin);
  }
  if (raw.length > MAX_QUOTE_CANDIDATES) {
    return jsonError(400, `too many candidates (max ${MAX_QUOTE_CANDIDATES})`, origin);
  }
  const candidates = raw.map((n) => (typeof n === 'string' ? n.trim() : ''));
  if (candidates.some((n) => !n || n.length > MAX_QUOTE_NAME_CHARS)) {
    return jsonError(400, `invalid candidate name (max ${MAX_QUOTE_NAME_CHARS} chars)`, origin);
  }

  // 限流（每 IP 每天 30 次，与 chat/image 独立计数）
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (await hitRateLimit(ip, env, 'quotes', DAILY_QUOTES_LIMIT_PER_IP)) {
    return jsonError(429, 'Rate limit exceeded: 30 quote requests/day per IP', origin);
  }

  // 服务端检索（cn.bing.com 国内与边缘节点均可达）
  const result = await searchQuotesViaBing(candidates, {
    base: env.BING_BASE?.trim() || undefined,
  });
  if (!result) {
    return jsonError(404, 'not_found', origin);
  }
  return new Response(
    JSON.stringify({ quotes: result.quotes, usedName: result.usedName, source: 'bing' }),
    { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } },
  );
}
