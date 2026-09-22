/**
 * LLM 人物主题生成服务（双调用流程）
 *
 * Call 1「解析与审核」：判断用户输入是否为允许生成的人物
 *   （仅真实人物：历史、哲学、文学、科学、艺术等；
 *    拒绝非人物输入、娱乐圈明星、政治敏感/争议人物）。
 * Call 2「主题设计」：基于联网检索到的真实语录（见 quoteSearch.ts），
 *   让模型只做视觉设计并从给定语录中按编号挑选，严禁编造语录。
 *
 * 配置解析顺序：显式 VITE_PROXY_URL → VITE_LLM_* 环境变量（休眠回退）
 *   → 内置同源 /api（Vercel / 本地 dev 中间件，零配置，密钥在服务端）。
 */

import { hashString, type AppTheme, type ThemeQuote } from '@/themes';

/* ---------------------------------- 配置解析 ---------------------------------- */

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * 两种 LLM 接入模式：
 *  - proxy：服务端代理（默认，密钥在服务端，浏览器零配置）——
 *    显式 VITE_PROXY_URL（Cloudflare Worker）或内置同源 /api
 *    （Vercel Serverless / 本地 vite-plugin-dev-api 中间件）
 *  - byok-env：构建期注入的自备 Key（VITE_LLM_*，休眠回退，
 *    仅供高级自托管者使用，UI 不暴露）
 */
export type LlmMode = 'proxy' | 'byok-env';

/** 代理来源：explicit = VITE_PROXY_URL 显式注入；builtin = 内置同源 /api */
export type ProxySource = 'explicit' | 'builtin';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
/** 内置同源代理（Vercel Serverless Function，见 api/chat.ts） */
const BUILTIN_PROXY_BASE = '/api';

/** 官方代理地址（构建期注入；设置后走显式代理） */
export function getProxyUrl(): string | null {
  const url = import.meta.env.VITE_PROXY_URL as string | undefined;
  return url?.trim() ? url.trim() : null;
}

/**
 * 解析代理配置：显式 VITE_PROXY_URL（Cloudflare Worker，Chat Completions 路径补 /v1）
 * 优先；否则回退内置同源 /api（Vercel 部署与本地 dev 中间件开箱即用，
 * 请求经 vercel.json rewrite 到 /api/chat）。代理始终可用，无需配置即返回。
 */
export function getProxyConfig(): { baseUrl: string; source: ProxySource } {
  const explicit = getProxyUrl();
  if (explicit) {
    return { baseUrl: `${explicit.replace(/\/$/, '')}/v1`, source: 'explicit' };
  }
  return { baseUrl: BUILTIN_PROXY_BASE, source: 'builtin' };
}

/** 环境变量配置（VITE_LLM_*，休眠回退：仅适合私有部署，Key 会进浏览器产物） */
function getEnvConfig(): LlmConfig | null {
  const apiKey = import.meta.env.VITE_LLM_API_KEY as string | undefined;
  if (!apiKey) return null;
  return {
    baseUrl: (import.meta.env.VITE_LLM_BASE_URL as string | undefined) || DEFAULT_BASE_URL,
    model: (import.meta.env.VITE_LLM_MODEL as string | undefined) || DEFAULT_MODEL,
    apiKey,
  };
}

/**
 * 解析生效配置与模式（应用始终使用部署方/自托管者配置的接口，访客无任何设置项）。
 * 优先级：显式代理（VITE_PROXY_URL）> VITE_LLM_* 环境变量（静态自托管的休眠回退，
 * 此时同源 /api 通常不存在）> 内置同源代理 /api（Vercel / 本地 dev 中间件，零配置）。
 * 代理模式不需要真实 Key，发送无害的占位 bearer（服务端不校验）。
 */
export function resolveLlm(): {
  config: LlmConfig;
  mode: LlmMode;
  proxySource?: ProxySource;
} {
  if (getProxyUrl()) {
    const proxy = getProxyConfig();
    return {
      config: { baseUrl: proxy.baseUrl, model: 'proxy', apiKey: 'proxy' },
      mode: 'proxy',
      proxySource: proxy.source,
    };
  }
  const env = getEnvConfig();
  if (env) return { config: env, mode: 'byok-env' };
  // 内置同源代理：Vercel 部署（api/chat.ts）/ 本地 dev 中间件开箱即用
  return {
    config: { baseUrl: BUILTIN_PROXY_BASE, model: 'proxy', apiKey: 'proxy' },
    mode: 'proxy',
    proxySource: 'builtin',
  };
}

/* ---------------------------------- 错误类型 ---------------------------------- */

export type LlmErrorKind = 'network' | 'http' | 'parse' | 'timeout' | 'config' | 'rate-limit';

export class LlmError extends Error {
  kind: LlmErrorKind;
  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
  }
}

/** 审核或检索不通过时的「拒绝生成」错误（message 为面向用户的中文原因） */
export class RefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusalError';
  }
}

/* --------------------------------- 通用请求 --------------------------------- */

const TIMEOUT_MS = 45_000;

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** 一次 Chat Completions 调用，返回助手文本；失败抛 LlmError */
async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  const { config } = resolveLlm();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.7 }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new LlmError('timeout', `请求超时（${TIMEOUT_MS / 1000} 秒）`);
    }
    throw new LlmError('network', e instanceof Error ? e.message : '网络请求失败');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // 服务端代理的每 IP 防滥用限流（保护部署者的 API 额度）：映射为友好提示
    if (res.status === 429) {
      throw new LlmError('rate-limit', '今日生成次数已达上限，明天再来吧');
    }
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 120);
    } catch {
      // 忽略读取响应体的失败
    }
    throw new LlmError('http', `${res.status} ${res.statusText}${detail ? `：${detail}` : ''}`);
  }

  try {
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('empty content');
    return content;
  } catch {
    throw new LlmError('parse', 'API 响应格式不符合预期');
  }
}

/** 从模型输出中稳健提取 JSON 对象（去围栏、取首个 {...} 块） */
function extractJson(raw: string): Record<string, unknown> {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new LlmError('parse', '模型输出中未找到 JSON');
  }
  text = text.slice(start, end + 1);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new LlmError('parse', '模型输出的 JSON 无法解析');
  }
}

/* ------------------------------ Call 1：解析与审核 ------------------------------ */

export interface ModerationResult {
  isPerson: boolean;
  personName: string | null;
  /** 最常用中文简称（如 文森特·梵高 → 梵高、玛丽·居里 → 居里夫人），用于语录检索候选 */
  shortName: string | null;
  category: string;
  allow: boolean;
  reason: string;
}

const MODERATION_PROMPT = `你是一个内容审核助手。用户会输入一句话（通常是"我喜欢……"），你要判断句子中提到的是否为可以生成应用主题的人物。

请严格输出 JSON（不要输出任何其他文字、不要用 markdown 代码块包裹）：
{
  "isPerson": true 或 false,
  "personName": "标准中文人物名，不是人物则为 null",
  "shortName": "该人物最常用的中文简称（如 文森特·梵高→梵高、玛丽·居里→居里夫人、阿尔伯特·爱因斯坦→爱因斯坦；无更短常用名时与 personName 相同），不是人物则为 null",
  "category": "historical | philosopher | writer | scientist | artist | entertainment_celebrity | political_sensitive | other | not_person",
  "allow": true 或 false,
  "reason": "拒绝原因（中文、对用户友好），允许时为空字符串"
}

审核策略：
- 仅允许真实人物：历史人物、哲学家、作家、科学家、艺术家等
- 以下情况必须拒绝（allow=false）：
  1. 输入不是人物名（如风景、物品、活动：海边、星空、骑行）→ category 填 not_person
  2. 娱乐圈明星、流量艺人、偶像 → category 填 entertainment_celebrity
  3. 政治敏感人物、争议人物、罪犯等 → category 填 political_sensitive
- reason 示例："娱乐圈明星暂不支持"、"政治敏感人物暂不支持"`;

/**
 * 解析并审核用户输入。
 * 通过：返回 allow=true 与标准人物名。
 * 不通过：抛 RefusalError（message 为面向用户的友好中文原因）。
 */
export async function moderatePersonInput(sentence: string): Promise<ModerationResult> {
  const content = await chatCompletion([
    { role: 'system', content: MODERATION_PROMPT },
    { role: 'user', content: sentence },
  ]);
  const data = extractJson(content);

  const isPerson = data.isPerson === true;
  const personName =
    typeof data.personName === 'string' && data.personName.trim()
      ? data.personName.trim()
      : null;
  const shortName =
    typeof data.shortName === 'string' && data.shortName.trim()
      ? data.shortName.trim()
      : null;
  const category = typeof data.category === 'string' ? data.category : 'other';
  const allow = data.allow === true;
  const reason = typeof data.reason === 'string' ? data.reason.trim() : '';

  const result: ModerationResult = { isPerson, personName, shortName, category, allow, reason };

  if (!allow || !isPerson || !personName) {
    if (!isPerson || category === 'not_person') {
      throw new RefusalError('未检测到人物名，请输入你喜欢的人物，如：我喜欢苏轼');
    }
    throw new RefusalError(
      `暂不支持生成该人物的主题：${reason || '该人物暂不支持'}`,
    );
  }
  return result;
}

/* --------------------- 宽松兜底：凭模型知识生成语录（可选） --------------------- */

const QUOTES_PROMPT = `你是语录助手。请凭你自己的知识，给出指定人物的 6-8 条著名真实语录。

严格要求：
- 只给你高度确信是真实存在的语录，严禁编造；拿不准的宁可少给
- 出处不确定的，source 标「佚名」或「传为本人所言」
- 严格输出 JSON 数组（不要输出任何其他文字、不要用 markdown 代码块包裹）：
  [{"text": "语录原文", "source": "出处（作者/作品）"}]`;

/**
 * 宽松兜底（仅 VITE_QUOTE_FALLBACK=llm 时由 quoteSearch 调用）：
 * 联网检索全部失败时，凭模型知识生成语录。返回的每条语录都带
 * unverified: true 标记——UI 必须如实标注「未经核验」。
 */
export async function generateQuotesWithLLM(personName: string): Promise<ThemeQuote[]> {
  const content = await chatCompletion([
    { role: 'system', content: QUOTES_PROMPT },
    { role: 'user', content: `人物：${personName}` },
  ]);
  // 提取 JSON 数组（去围栏、取首个 [...] 块）
  let text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) {
    throw new LlmError('parse', '模型输出中未找到语录 JSON 数组');
  }
  text = text.slice(start, end + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LlmError('parse', '模型输出的语录 JSON 无法解析');
  }
  if (!Array.isArray(raw)) {
    throw new LlmError('parse', '模型输出的语录不是数组');
  }
  const quotes: ThemeQuote[] = [];
  for (const item of raw) {
    const q = item as { text?: unknown; source?: unknown };
    if (typeof q?.text !== 'string' || !q.text.trim()) continue;
    quotes.push({
      text: q.text.trim().slice(0, 80),
      source:
        typeof q.source === 'string' && q.source.trim()
          ? q.source.trim().slice(0, 40)
          : '佚名',
      unverified: true,
    });
    if (quotes.length >= 8) break;
  }
  if (quotes.length < 3) {
    throw new LlmError('parse', '模型未能给出足够的真实语录');
  }
  return quotes;
}

/* ------------------------------ Call 2：主题设计 ------------------------------ */

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 粗略亮度估计（0-255），用于 textOnBg 校验/兜底 */
function luminance(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

const DESIGN_PROMPT = `你是一个日程应用的主题设计师。用户喜欢某位人物，我们已经从互联网检索到该人物的真实语录（编号列表见用户消息；每条括号内是来源——可能是著作名，也可能是检索到的网站域名，如「网络检索·zhihu.com」）。你的任务：

1. 为该人物设计一套应用视觉主题（主题名、强调色、渐变、文字明暗、emoji）
2. 从给定的语录编号中挑选 6-8 条最适合的（quoteIds）——只挑真正像「人物语录/诗文名句」的条目，跳过介绍性、评论性的网页摘句
3. 为该人物写一段英文文生图提示词（portraitPrompt），用于生成应用 Logo 画像

请严格输出 JSON（不要输出任何其他文字、不要用 markdown 代码块包裹）：
{
  "name": "主题名（2-6个汉字，体现人物气质）",
  "keyword": "人物名",
  "primaryColor": "#开头的十六进制强调色",
  "gradient": ["#颜色1", "#颜色2", "#颜色3（可选）"],
  "textOnBg": "dark 或 light（渐变偏亮用 dark 深色文字，偏暗用 light 浅色文字）",
  "emoji": "一个最能代表该人物的 emoji",
  "quoteIds": [从给定语录编号中选 6-8 个整数],
  "portraitPrompt": "英文文生图提示词（见下方要求）"
}

严格要求：
- quoteIds 只能引用给定语录的编号，严禁编造或改写语录
- gradient 给 2-3 个颜色，搭配和谐、契合人物气质
- portraitPrompt 必须是英文，描述该人物的半身肖像：雕刻/铜版蚀刻（engraved etching）或契合人物气质的艺术风格，圆形徽章（circular medallion）构图，色调与 primaryColor 呼应，画面不含任何文字`;

/** portraitPrompt 缺失/无效时的兜底：由人物名与强调色合成 */
function fallbackPortraitPrompt(personName: string, primaryColor: string): string {
  return `Engraved etching style bust portrait of ${personName}, circular medallion composition, ${primaryColor} monochrome tones, plain background, no text`;
}

/**
 * 基于检索到的真实语录，让 LLM 设计视觉主题并按编号挑选语录。
 * 模型只能引用给定语录，禁止编造。
 */
export async function designThemeWithLLM(
  personName: string,
  quotes: ThemeQuote[],
): Promise<AppTheme> {
  const quoteList = quotes.map((q, i) => `${i + 1}. ${q.text}（${q.source}）`).join('\n');
  const content = await chatCompletion([
    { role: 'system', content: DESIGN_PROMPT },
    {
      role: 'user',
      content: `人物：${personName}\n\n检索到的真实语录：\n${quoteList}`,
    },
  ]);
  const data = extractJson(content);

  // 视觉字段校验
  if (typeof data.name !== 'string' || !data.name.trim()) {
    throw new LlmError('parse', '缺少有效的主题名 name');
  }
  if (typeof data.primaryColor !== 'string' || !HEX_RE.test(data.primaryColor)) {
    throw new LlmError('parse', '缺少有效的强调色 primaryColor');
  }
  if (
    !Array.isArray(data.gradient) ||
    data.gradient.length < 2 ||
    !data.gradient.every((c) => typeof c === 'string' && HEX_RE.test(c))
  ) {
    throw new LlmError('parse', '缺少有效的渐变色 gradient（至少 2 个十六进制颜色）');
  }

  // quoteIds → 映射回检索语录（1 基编号；非法编号丢弃）
  const ids = Array.isArray(data.quoteIds) ? data.quoteIds : [];
  const picked: ThemeQuote[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    const idx = typeof id === 'number' ? id - 1 : Number(id) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < quotes.length && !seen.has(idx)) {
      seen.add(idx);
      picked.push(quotes[idx]);
    }
  }
  if (picked.length < 3) {
    throw new LlmError('parse', '模型未能从检索语录中选出足够的语录');
  }

  // textOnBg 校验：非法值时按渐变亮度推断
  let textOnBg: 'dark' | 'light';
  if (data.textOnBg === 'dark' || data.textOnBg === 'light') {
    textOnBg = data.textOnBg;
  } else {
    const avg =
      (data.gradient as string[]).reduce((sum, c) => sum + luminance(c), 0) /
      (data.gradient as string[]).length;
    textOnBg = avg > 150 ? 'dark' : 'light';
  }

  // portraitPrompt 校验：非空字符串且足够具体，否则用人物名 + 强调色合成兜底
  const rawPrompt = typeof data.portraitPrompt === 'string' ? data.portraitPrompt.trim() : '';
  const portraitPrompt =
    rawPrompt.length >= 20 ? rawPrompt : fallbackPortraitPrompt(personName, data.primaryColor);

  return {
    id: `ai-${hashString(personName).toString(16)}`,
    name: data.name.trim().slice(0, 12),
    keyword: personName,
    gradient: `linear-gradient(135deg, ${(data.gradient as string[]).slice(0, 3).join(', ')})`,
    primaryColor: data.primaryColor,
    textOnBg,
    emoji: typeof data.emoji === 'string' ? data.emoji.trim().slice(0, 4) : '✨',
    quotes: picked.slice(0, 8),
    generated: true,
    portraitPrompt,
  };
}
