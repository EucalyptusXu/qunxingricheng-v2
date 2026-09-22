/**
 * 群星日程 · 语录检索代理（Vercel Serverless Function，Edge Runtime）
 *
 * 为什么需要它：语录检索统一走服务端（cn.bing.com 无 CORS，浏览器无法直连；
 * 且国内访问 cn.bing.com 稳定，Vercel 边缘节点亦可达）。
 *   浏览器 → POST /api/quotes（或 GET /api/quotes?candidates=a,b）→ 本函数 → cn.bing.com
 *
 * 检索算法共享自 shared/websearch.ts（与 Cloudflare Worker 同源）：
 * 候选名按序尝试 → 「经典语录/名句/名言」三组查询词 → 解析结果页摘要 → ≥3 条即胜。
 *
 * 加固（与 api/chat.ts / api/image.ts 同步维护）：
 *  - 候选名 ≤6 个、每个 ≤50 字符
 *  - 限流：每 IP 每天 30 次（检索便宜但防滥用；模块级 Map 单实例 best-effort，
 *    精确限流可换 Upstash Redis，见 api/chat.ts 文件头注释）
 *  - ALLOWED_ORIGINS 可选白名单；不含任何密钥
 *
 * 环境变量：
 *  - BING_BASE        可选，检索站点覆盖（默认 https://cn.bing.com）
 *  - ALLOWED_ORIGINS  可选，逗号分隔的 Origin 白名单
 */

import { searchQuotesViaBing } from '../shared/websearch';

export const config = { runtime: 'edge' };

// Edge Runtime 无 @types/node 依赖，最小声明 Vercel 注入的 process.env
declare const process: { env: Record<string, string | undefined> };

const MAX_CANDIDATES = 6;
const MAX_NAME_CHARS = 50;
const DAILY_QUOTES_LIMIT_PER_IP = 30;

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function corsHeaders(origin: string | null): Record<string, string> {
  return origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

// 单实例内存限流（best-effort），与 chat/image 函数相互独立计数
const memoryCounters = new Map<string, { date: string; count: number }>();

function hitRateLimit(ip: string): boolean {
  const date = todayKey();
  const entry = memoryCounters.get(ip);
  if (!entry || entry.date !== date) {
    memoryCounters.set(ip, { date, count: 1 });
    return false;
  }
  if (entry.count >= DAILY_QUOTES_LIMIT_PER_IP) return true;
  entry.count += 1;
  return false;
}

/* --------------------------------- 主入口 --------------------------------- */

/** 从 GET query 或 POST body 解析候选名数组 */
async function parseCandidates(request: Request): Promise<string[] | null> {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const raw = url.searchParams.get('candidates');
    if (raw) return raw.split(',');
    const single = url.searchParams.get('person');
    return single ? [single] : null;
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (Array.isArray(body.candidates)) return body.candidates as string[];
  if (typeof body.person === 'string') return [body.person];
  return null;
}

export default async function handler(request: Request): Promise<Response> {
  const origin = allowedOrigin(request);

  // CORS 预检
  if (request.method === 'OPTIONS') {
    if (request.headers.get('Origin') && !origin) {
      return json(403, { error: { message: 'Origin not allowed' } }, null);
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return json(405, { error: { message: 'Method not allowed' } }, origin);
  }
  if (request.headers.get('Origin') && !origin) {
    return json(403, { error: { message: 'Origin not allowed' } }, null);
  }

  // 输入解析与上限
  const raw = await parseCandidates(request);
  if (!raw || raw.length === 0) {
    return json(400, { error: { message: 'candidates or person is required' } }, origin);
  }
  if (raw.length > MAX_CANDIDATES) {
    return json(400, { error: { message: `too many candidates (max ${MAX_CANDIDATES})` } }, origin);
  }
  const candidates = raw.map((n) => (typeof n === 'string' ? n.trim() : ''));
  if (candidates.some((n) => !n || n.length > MAX_NAME_CHARS)) {
    return json(400, { error: { message: `invalid candidate name (max ${MAX_NAME_CHARS} chars)` } }, origin);
  }

  // 限流（每 IP 每天 30 次；Vercel 经 x-forwarded-for 传递真实 IP）
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';
  if (hitRateLimit(ip)) {
    return json(429, { error: { message: 'Rate limit exceeded: 30 quote requests/day per IP' } }, origin);
  }

  // 服务端检索（cn.bing.com 国内与边缘节点均可达）
  const result = await searchQuotesViaBing(candidates, {
    base: env('BING_BASE') || undefined,
  });
  if (!result) {
    return json(404, { error: 'not_found' }, origin);
  }
  return json(200, { quotes: result.quotes, usedName: result.usedName, source: 'bing' }, origin);
}
