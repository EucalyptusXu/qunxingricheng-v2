/**
 * 群星日程 · 主题引擎
 *
 * 核心思想（每位敬仰的人物都是一颗星）：用户输入「我喜欢某人物」，
 * 命中内置人物主题则直接使用本地精心制作的主题；
 * 未命中则走「审核 → 联网检索真实语录 → LLM 设计」的在线生成流程
 * （见 src/services/llmTheme.ts 与 src/services/quoteSearch.ts）。
 */

export interface ThemeQuote {
  text: string;
  source: string;
  /**
   * true = 该语录未经联网核验（VITE_QUOTE_FALLBACK=llm 宽松模式下由大模型凭知识生成）。
   * UI 必须如实标注（头部徽标 / 画廊「未核验」标签）；默认严格模式不会产生此标记。
   */
  unverified?: boolean;
}

export interface AppTheme {
  id: string;
  /** 主题名，如「阳明心学」 */
  name: string;
  /** 从用户输入中提取出的关键词 */
  keyword: string;
  /** 背景图（public 下的路径）；为空则使用 gradient */
  backgroundImage?: string;
  /** CSS 渐变，作为无背景图时的方案 */
  gradient?: string;
  /** 主题 Logo；为空则使用默认图标 */
  logo?: string;
  /** 主题强调色（按钮 / 徽标等） */
  primaryColor: string;
  /** 背景上的文字用深色还是浅色 */
  textOnBg: 'dark' | 'light';
  /** 字体族，如宋体衬线 */
  fontStyle?: string;
  /** 主题语录轮播 */
  quotes: ThemeQuote[];
  /** 是否为动态生成的主题 */
  generated?: boolean;
  /** 代表主题的 emoji（AI 生成主题附带，用于背景水印与画廊展示） */
  emoji?: string;
  /** AI 生成主题附带：人物画像的英文文生图提示词（供 imageGen.ts 使用，画像失败时仅作兜底参考） */
  portraitPrompt?: string;
}

/**
 * 解析 logo 地址：blob:/data:/http(s)（AI 生成的运行时画像）直接使用，
 * 其余视为 public 下的静态资源路径，拼 BASE_URL。
 */
export function resolveLogoSrc(logo: string): string {
  return /^(blob:|data:|https?:)/i.test(logo) ? logo : `${import.meta.env.BASE_URL}${logo}`;
}

/* ---------------------------------- 内置主题 ---------------------------------- */

export const defaultTheme: AppTheme = {
  id: 'default',
  name: '极简',
  keyword: '',
  gradient: 'linear-gradient(135deg, #f5f7fa 0%, #e4ecf7 50%, #dfe9f3 100%)',
  primaryColor: '#3b5bdb',
  textOnBg: 'dark',
  quotes: [
    { text: '不积跬步，无以至千里；不积小流，无以成江海。', source: '《荀子·劝学》' },
    { text: '明日复明日，明日何其多。我生待明日，万事成蹉跎。', source: '钱福《明日歌》' },
    { text: '合理安排时间，就等于节约时间。', source: '弗朗西斯·培根' },
    { text: '把今天过好，就是对明天最好的准备。', source: '群星日程' },
    { text: '专注当下，万事可成。', source: '群星日程' },
    { text: '优秀不是一种行为，而是一种习惯。', source: '亚里士多德（相传）' },
  ],
};

export const wangyangmingTheme: AppTheme = {
  id: 'wangyangming',
  name: '阳明心学',
  keyword: '王阳明',
  backgroundImage: 'themes/wangyangming-bg.jpg',
  logo: 'themes/yangming-logo.png',
  primaryColor: '#9e2b25',
  textOnBg: 'dark',
  fontStyle: '"Songti SC", "STSong", "Noto Serif SC", serif',
  quotes: [
    { text: '知是行之始，行是知之成。', source: '《传习录》' },
    { text: '未有知而不行者。知而不行，只是未知。', source: '《传习录》' },
    { text: '心即理也。天下又有心外之事、心外之理乎？', source: '《传习录》' },
    { text: '破山中贼易，破心中贼难。', source: '《与杨仕德薛尚谦书》' },
    { text: '志不立，天下无可成之事。', source: '《教条示龙场诸生》' },
    { text: '不贵于无过，而贵于能改过。', source: '《教条示龙场诸生》' },
    { text: '人须在事上磨，方立得住，方能静亦定、动亦定。', source: '《传习录》' },
    { text: '种树者必培其根，种德者必养其心。', source: '《传习录》' },
    { text: '你未看此花时，此花与汝心同归于寂；你来看此花时，则此花颜色一时明白起来。', source: '《传习录》' },
    { text: '此心光明，亦复何言。', source: '王阳明临终遗言' },
  ],
};

export const kantTheme: AppTheme = {
  id: 'kant',
  name: '康德 · 理性星空',
  keyword: '康德',
  backgroundImage: 'themes/kant-bg.jpg',
  logo: 'themes/kant-logo.png',
  primaryColor: '#6d8fc4',
  textOnBg: 'light',
  quotes: [
    {
      text: '有两种东西，我对它们的思考越是深沉和持久，它们在我心灵中唤起的惊奇和敬畏就越日新月异——这就是我头顶的星空和心中的道德律。',
      source: '康德《实践理性批判》',
    },
    { text: '要只按照你同时愿意它成为普遍法则的准则去行动。', source: '康德《道德形而上学奠基》' },
    {
      text: '你在任何时候都同时把人性当作目的，绝不仅仅当作手段来使用。',
      source: '康德《道德形而上学奠基》',
    },
    { text: '要有勇气运用你自己的理智！这就是启蒙运动的口号。', source: '康德《答复这个问题：什么是启蒙运动？》' },
    { text: '我们的一切知识都从经验开始，这是没有任何怀疑的。', source: '康德《纯粹理性批判》' },
    { text: '美是一种无利害关系的愉悦。', source: '康德《判断力批判》' },
    { text: '三样东西有助于缓解生命的辛劳：希望、睡眠和笑。', source: '康德《实用人类学》' },
  ],
};

export const nietzscheTheme: AppTheme = {
  id: 'nietzsche',
  name: '尼采 · 超人意志',
  keyword: '尼采',
  backgroundImage: 'themes/nietzsche-bg.jpg',
  logo: 'themes/nietzsche-logo.png',
  primaryColor: '#8a5a2b',
  textOnBg: 'dark',
  quotes: [
    { text: '凡不能杀死我的，使我更强大。', source: '尼采《偶像的黄昏》' },
    { text: '一个人知道自己为什么而活，就可以忍受任何一种生活。', source: '尼采《偶像的黄昏》' },
    {
      text: '与怪物战斗的人，应当小心自己不要成为怪物。当你长久凝视深渊时，深渊也在凝视你。',
      source: '尼采《善恶的彼岸》',
    },
    { text: '每一个不曾起舞的日子，都是对生命的辜负。', source: '尼采《查拉图斯特拉如是说》' },
    { text: '人是一根绳索，系在动物与超人之间——凌驾于深渊之上的绳索。', source: '尼采《查拉图斯特拉如是说》' },
    { text: '上帝死了！是我们杀死了他！', source: '尼采《快乐的科学》' },
    { text: '成为你自己！', source: '尼采《作为教育家的叔本华》' },
  ],
};

export const builtinThemes: AppTheme[] = [
  defaultTheme,
  wangyangmingTheme,
  kantTheme,
  nietzscheTheme,
];

/** 主题画廊展示的人物预设（极简为默认主题但不进画廊） */
export const presetGalleryThemes: AppTheme[] = [
  wangyangmingTheme,
  kantTheme,
  nietzscheTheme,
];

/* --------------------------------- 关键词提取 --------------------------------- */

/** 去掉句首常见的「我喜欢 / 我想……」等引导词，提取核心关键词 */
export function extractKeyword(input: string): string {
  let s = input.trim();
  // 常见引导句式，按从长到短匹配
  const prefixes = [
    '我最近迷上了', '我最近迷上', '最近迷上了', '最近迷上',
    '我特别喜欢', '我特别喜欢看', '我喜欢看', '我喜欢听', '我喜欢读',
    '我喜欢', '我热爱', '我爱看', '我爱', '我想去', '我想看', '我想学', '我想',
    '特别喜欢', '喜欢', '热爱', '迷上了', '迷上',
  ];
  for (const p of prefixes) {
    if (s.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }
  // 去掉标点与空白
  s = s.replace(/[，。！？!?,.\s、~～…·"'「」『』]/g, '');
  // 关键词过长时截断，保证 UI 展示友好
  if (s.length > 8) s = s.slice(0, 8);
  return s || '远方';
}

/* --------------------------------- 主题匹配逻辑 --------------------------------- */

const MATCH_RULES: { patterns: string[]; theme: AppTheme }[] = [
  { patterns: ['王阳明', '阳明', '心学', '知行合一', '传习录'], theme: wangyangmingTheme },
  { patterns: ['康德', 'immanuel kant', 'kant'], theme: kantTheme },
  { patterns: ['尼采', 'nietzsche'], theme: nietzscheTheme },
];

/** 简单的字符串哈希（FNV-1a 风格），保证同一关键词永远生成同一主题 */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 仅匹配内置预设主题；未命中返回 null（交由在线生成流程处理） */
export function matchPresetTheme(input: string): AppTheme | null {
  const lower = input.toLowerCase();
  for (const rule of MATCH_RULES) {
    if (rule.patterns.some((p) => lower.includes(p.toLowerCase()))) {
      return rule.theme;
    }
  }
  return null;
}
