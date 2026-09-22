/**
 * 真实语录联网检索（服务端代理）。
 *
 * 设计原则：绝不编造语录。检索失败或数量不足时抛 QuoteSearchError
 * （一种 RefusalError），由调用方取消生成，并在 UI 中如实告知用户。
 *
 * 为什么只能走服务端：语录检索改为国内互联网检索（cn.bing.com），
 * 必应结果页无 CORS 头，浏览器无法直连；因此检索统一由服务端代理完成
 * （Vercel /api/quotes 或 Worker /v1/quotes，本地开发由 Vite 中间件提供
 * /api——见 vite-plugin-dev-api.ts）。检索路径：
 *  ① 服务端代理 /quotes（同源 /api 或 VITE_PROXY_URL 指定的 Worker）
 *  ② 代理不可用/失败 → 宽松兜底（仅 VITE_QUOTE_FALLBACK=llm，凭大模型
 *     知识生成，产物带 unverified 标记，UI 如实标注「未经核验」）
 *  ③ 否则拒绝生成（宁可拒绝，不可编造）
 *
 * 候选名逻辑（修复「文森特·梵高检索不到」类问题）见 buildNameCandidates；
 * 检索核心算法共享自 shared/websearch.ts（Vercel 函数与 Worker 共用）。
 */

import { RefusalError, generateQuotesWithLLM, getProxyConfig } from '@/services/llmTheme';
import type { WebQuote } from '../../shared/websearch';
import type { ThemeQuote } from '@/themes';

const PROXY_TIMEOUT_MS = 20_000;

/**
 * 宽松兜底开关（显式 opt-in）：VITE_QUOTE_FALLBACK=llm 时，代理检索失败后
 * 凭大模型知识生成语录（每条带 unverified 标记，UI 如实标注「未经核验」）。
 * 默认关闭——严格模式宁可拒绝，不可编造。
 */
const LENIENT_FALLBACK =
  (import.meta.env.VITE_QUOTE_FALLBACK as string | undefined) === 'llm';

/** 检索失败 = 拒绝生成（message 为面向用户的中文原因） */
export class QuoteSearchError extends RefusalError {
  constructor(message: string) {
    super(message);
    this.name = 'QuoteSearchError';
  }
}

export interface QuoteSearchResult {
  quotes: ThemeQuote[];
  /** 实际检索成功的候选名（用于流水线展示，如「以『梵高』检索到 N 条」） */
  usedName: string;
  /** true = 经服务端代理检索；false = 宽松兜底（未经服务端检索） */
  viaProxy: boolean;
  /** true = 宽松兜底产物（大模型凭知识生成，未经联网核验） */
  unverified?: boolean;
}

/**
 * 构建候选人物名（去重、保序）：
 * shortName（最常用中文简称）> personName（审核归一化全名）> 用户输入关键词
 * > 名称变体（末段：文森特·梵高 → 梵高；去间隔号：文森特·梵高 → 文森特梵高）。
 */
export function buildNameCandidates(
  personName: string,
  shortName: string | null,
  userKeyword: string,
): string[] {
  const list: string[] = [];
  const push = (name?: string | null) => {
    const t = name?.trim();
    if (t && !list.includes(t)) list.push(t);
  };
  push(shortName);
  push(personName);
  push(userKeyword);
  for (const base of [shortName, personName]) {
    if (!base || !base.includes('·')) continue;
    push(base.split('·').filter(Boolean).pop());
    push(base.replace(/·/g, ''));
  }
  return list;
}

/* ------------------------------ 服务端代理 ------------------------------ */

interface ProxyQuotesResponse {
  quotes?: WebQuote[];
  usedName?: string;
}

/**
 * 经服务端代理（Vercel /api/quotes 或 Worker /v1/quotes）检索。
 * 返回 null 表示代理不可用（无此路由/网络失败/非预期响应/明确 not_found），
 * 由调用方决定宽松兜底或拒绝。
 */
async function searchViaProxy(candidates: string[]): Promise<QuoteSearchResult | null> {
  const { baseUrl } = getProxyConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates }),
      signal: controller.signal,
    });
  } catch {
    return null; // 网络失败（含纯静态部署无 /api）
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return null; // 404/405/501/429 等
  try {
    const data = (await res.json()) as ProxyQuotesResponse;
    if (!Array.isArray(data.quotes) || data.quotes.length < 3 || !data.usedName) return null;
    return { quotes: data.quotes, usedName: data.usedName, viaProxy: true };
  } catch {
    return null; // 非 JSON（如静态托管的 404 回退页）
  }
}

/* --------------------------------- 主入口 --------------------------------- */

/**
 * 检索人物的真实语录：服务端代理检索（cn.bing.com 无 CORS，无浏览器直连路径）；
 * 代理失败时——默认抛 QuoteSearchError（拒绝编造）；
 * 仅当 VITE_QUOTE_FALLBACK=llm 时凭大模型知识兜底（产物带 unverified 标记）。
 */
export async function searchQuotes(candidates: string[]): Promise<QuoteSearchResult> {
  const names = candidates.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) {
    throw new QuoteSearchError('未能在互联网检索到真实语录，为避免编造，已取消生成');
  }
  const viaProxy = await searchViaProxy(names);
  if (viaProxy) return viaProxy;
  if (LENIENT_FALLBACK) {
    // 宽松兜底：凭模型知识生成（可能抛 LlmError，由调用方按失败处理）
    const quotes = await generateQuotesWithLLM(names[0]);
    return { quotes, usedName: names[0], viaProxy: false, unverified: true };
  }
  throw new QuoteSearchError(
    `未能在互联网检索到「${names[0]}」的真实语录，为避免编造，已取消生成`,
  );
}
