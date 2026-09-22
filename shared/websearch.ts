/**
 * 国内互联网语录检索核心逻辑（共享模块，服务端两方共用）：
 *  - Vercel Serverless api/quotes.ts（Edge Runtime）
 *  - Cloudflare Worker workers/llm-proxy/src/index.ts
 *
 * 为什么取代维基语录：zh.wikiquote.org 在中国大陆被 GFW 封锁，且海外边缘
 * 节点访问也不稳定；cn.bing.com 国内直连与 Vercel/CF 边缘均可达，检索
 * 「<人物> 经典语录」的结果页摘要中即可抽取真实流传的语录。
 *
 * 依赖约束：只用 Web 标准 fetch / setTimeout / encodeURIComponent 与正则，
 * 不引用 DOM 库（Edge Runtime 没有）、不读 import.meta.env / process.env
 * ——配置全部由调用方传入。
 *
 * 算法：按候选名顺序请求 cn.bing.com 搜索页 → 正则解析 <li class="b_algo">
 * 结果块 → 抽取摘要文本与来源域名 → 切分/过滤/去重为候选语录行；
 * 任一候选拿到 ≥3 条即返回；全部失败返回 null（不抛异常）。
 */

export interface WebQuote {
  text: string;
  /** 来源标签：网络检索·<域名>（如 网络检索·zhihu.com） */
  source: string;
}

export interface WebSearchResult {
  quotes: WebQuote[];
  /** 实际检索成功的候选名 */
  usedName: string;
}

export interface WebSearchOptions {
  /** Bing 站点覆盖（默认 https://cn.bing.com，可被 BING_BASE 覆盖） */
  base?: string;
  /** 单次请求超时（默认 15s） */
  timeoutMs?: number;
}

const MIN_QUOTES = 3;
const MAX_QUOTES = 15;
/** 候选语录行长度窗口 */
const MIN_LINE_CHARS = 6;
const MAX_LINE_CHARS = 60;

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 导航/广告/站务噪声关键词（命中即丢弃该行） */
const JUNK_PATTERN =
  /广告|推广|版权|举报|备案|登录|注册|下载|查看更多|展开全文|必应|免责声明|cookie|隐私|APP|小程序/;

async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 去 HTML 标签 + 解码常见实体（Edge Runtime 无 DOM，纯字符串处理） */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&ensp;|&emsp;|&thinsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
}

/** 从 cite 文本中提取域名（如 "https://www.zhihu.com › question › ..." → zhihu.com） */
function extractDomain(citeText: string): string {
  const m = citeText.match(/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
  if (!m) return '';
  return m[1].replace(/^www\./, '').toLowerCase();
}

/** 把摘要切分为候选语录行：先按换行，超长段再按句读切分 */
function splitQuoteLines(text: string): string[] {
  return text.split(/[\n\r]+/).flatMap((seg) => {
    const s = seg.trim();
    if (s.length <= MAX_LINE_CHARS) return [s];
    // 长段按中文句读切分（保留句末标点）
    return s.match(new RegExp(`[^。！？!?；;]{${MIN_LINE_CHARS},${MAX_LINE_CHARS - 1}}[。！？!?；;]?`, 'g')) ?? [];
  });
}

/** 判断是否为可用的语录行 */
function isQuoteLine(line: string): boolean {
  if (line.length < MIN_LINE_CHARS || line.length > MAX_LINE_CHARS) return false;
  const hanzi = line.match(/[一-鿿]/g)?.length ?? 0;
  if (hanzi < 4) return false; // 至少 4 个汉字（滤掉「年7月2日」类碎片）
  if (/https?:\/\/|www\.|\.com|\.cn|\.net|\.org/i.test(line)) return false; // URL 垃圾
  // 日期/时效前缀碎片（必应摘要常以「2025年7月2日 · 」「3小时之前 · 」开头）
  if (/^\d{4}年\d{1,2}月\d{1,2}日/.test(line)) return false;
  if (/^年\d{1,2}月\d{1,2}日/.test(line)) return false;
  if (/^\d*\s*(小时|分钟|天|周)之前/.test(line)) return false;
  if (/^[…—–-]|[…—–-]$/.test(line)) return false; // 摘要截断的残句
  if (JUNK_PATTERN.test(line)) return false;
  return true;
}

/**
 * 解析一个搜索结果页，返回去重后的候选语录（≤ MAX_QUOTES 条）。
 * 相关性闸门：必应会把部分查询拆字降级（苏轼→苏、文森特·梵高→文森特主播），
 * 此时结果标题大多不含人物名——少于 2 个标题命中即视为降级页，返回空。
 */
function parseResultPage(html: string, name: string): WebQuote[] {
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
  // 名称匹配键：去间隔号（文森特·梵高 → 文森特梵高，标题实体解码后同理）
  const nameKey = name.replace(/[·\s]/g, '');
  let titleHits = 0;

  interface Block {
    source: string;
    snippet: string;
    hit: boolean;
  }
  const parsed: Block[] = [];
  for (const block of blocks) {
    const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const title = titleMatch ? htmlToText(titleMatch[1]) : '';
    const hit = nameKey.length > 0 && title.replace(/[·\s]/g, '').includes(nameKey);
    if (hit) titleHits += 1;
    const citeMatch = block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/);
    const domain = citeMatch ? extractDomain(htmlToText(citeMatch[1])) : '';
    const pMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    parsed.push({
      source: domain ? `网络检索·${domain}` : '网络检索',
      snippet: pMatch ? htmlToText(pMatch[1]).trim() : '',
      hit,
    });
  }
  if (titleHits < 2) return []; // 降级页/不相关页

  const quotes: WebQuote[] = [];
  const seen = new Set<string>();
  // 标题命中人物名的结果块优先（更可能是语录页）
  for (const block of [...parsed.filter((b) => b.hit), ...parsed.filter((b) => !b.hit)]) {
    if (!block.snippet) continue;
    for (const line of splitQuoteLines(block.snippet)) {
      // 日期前缀必须在剥离前判断（剥离会吃掉年份数字，留下「年7月2日」）
      if (!isQuoteLine(line)) continue;
      const cleaned = line
        .replace(/^[「『"'\s\d.、]+/, '')
        .replace(/[」』"'\s]+$/, '')
        .replace(/——[^—]{1,12}[.。]?$/, '') // 剥离行尾「——梵高」类署名（来源另有标注）
        .trim();
      if (!isQuoteLine(cleaned)) continue;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      quotes.push({ text: cleaned, source: block.source });
      if (quotes.length >= MAX_QUOTES) return quotes;
    }
  }
  return quotes;
}

/**
 * 按候选名顺序经 cn.bing.com 检索真实语录：
 * 每个候选名搜索「<名字> 经典语录」，解析结果页摘要；
 * 找到 ≥3 条即返回；全部失败返回 null（由调用方决定拒绝或回退）。
 */
export async function searchQuotesViaBing(
  candidates: string[],
  options: WebSearchOptions = {},
): Promise<WebSearchResult | null> {
  const names = candidates.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return null;
  const base = (options.base ?? 'https://cn.bing.com').replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? 15_000;

  for (const name of names) {
    // 实测：「<名> 经典语录」对部分名字会被必应拆字降级（苏轼→苏、李清照→李），
    // 「名句」「名言」结果相关性更稳——三个查询词依次尝试，任一拿到 ≥3 条即胜
    for (const query of [`${name} 经典语录`, `${name} 名句`, `${name} 名言`]) {
      try {
        const url =
          `${base}/search?q=${encodeURIComponent(query)}` +
          `&setlang=zh-CN&count=20`;
        const html = await fetchHtml(url, timeoutMs);
        const quotes = parseResultPage(html, name);
        if (quotes.length >= MIN_QUOTES) {
          return { quotes, usedName: name };
        }
      } catch {
        // 单查询失败（网络/超时/HTTP 错误）→ 尝试下一个查询词/候选名
      }
    }
  }
  return null;
}
