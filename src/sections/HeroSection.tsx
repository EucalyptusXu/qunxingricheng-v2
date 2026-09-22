import { useRef, useState } from 'react';
import { Bot, BrainCircuit, ImagePlus, Palette, Search, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemePipeline, type PipelineStepDef } from '@/components/ThemePipeline';
import { extractKeyword, matchPresetTheme, type AppTheme, type ThemeQuote } from '@/themes';
import {
  designThemeWithLLM,
  LlmError,
  moderatePersonInput,
  resolveLlm,
  RefusalError,
} from '@/services/llmTheme';
import { generatePortrait } from '@/services/imageGen';
import { buildNameCandidates, searchQuotes } from '@/services/quoteSearch';

/** 快速体验口令：前两个命中人物预设，第三个走在线生成流程 */
const QUICK_CHIPS = ['我喜欢王阳明', '我喜欢康德', '我喜欢苏轼'];

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Props {
  theme: AppTheme;
  onThemeApplied: (theme: AppTheme) => void;
}

/**
 * 「一句话换主题」输入区。
 * - 命中人物预设（王阳明/康德/尼采）→ 本地数据 + 动效流水线
 * - 未命中 → 在线生成：解析与审核人物 → 联网检索真实语录 → 大模型设计视觉主题 → 生成人物画像 → 应用主题
 *   · 仅允许真实人物；非人物 / 娱乐明星 / 敏感人物 → 拒绝并说明原因
 *   · 语录必须来自国内互联网检索，检索不到则拒绝，绝不编造
 *   · 前端不限生成次数；服务端保留每 IP 防滥用限流（保护部署者 API 额度）
 */
export function HeroSection({ theme, onThemeApplied }: Props) {
  const [input, setInput] = useState('');
  const [runId, setRunId] = useState(0);
  const [steps, setSteps] = useState<PipelineStepDef[]>([]);
  const [running, setRunning] = useState(false);
  const resultRef = useRef<AppTheme | null>(null);

  const isLightText = theme.textOnBg === 'light';

  const applyStep = (): PipelineStepDef => ({
    key: 'apply',
    label: '应用主题',
    icon: <Sparkles className="h-4 w-4" />,
    run: async () => {
      await delay(500);
      return '主题已切换，愿你度过高效的一天';
    },
  });

  const start = (text: string) => {
    const s = text.trim();
    if (!s || running) return;
    setInput(s);

    const preset = matchPresetTheme(s);

    if (preset) {
      // 路径 1：内置人物预设，本地数据 + 动效流水线（不消耗额度）
      resultRef.current = preset;
      setSteps([
        {
          key: 'parse',
          label: '解析需求',
          icon: <BrainCircuit className="h-4 w-4" />,
          run: async () => {
            await delay(600);
            return `提取关键词：「${preset.keyword}」`;
          },
        },
        {
          key: 'search',
          label: '检索语录与素材',
          icon: <Search className="h-4 w-4" />,
          run: async () => {
            await delay(700);
            return `找到 ${preset.quotes.length} 条相关语录`;
          },
        },
        {
          key: 'generate',
          label: '生成视觉主题',
          icon: <Palette className="h-4 w-4" />,
          run: async () => {
            await delay(700);
            return `匹配到内置主题「${preset.name}」`;
          },
        },
        applyStep(),
      ]);
    } else {
      // 路径 2：在线生成（人物专属 + 安全审核 + 真实语录；不限次数，
      // 服务端代理另有每 IP 防滥用限流，429 时给出友好提示）
      const resolved = resolveLlm();
      const modelLabel = resolved.mode === 'byok-env' ? resolved.config.model : '';
      // 步骤闭包共享的中间结果
      let personName = '';
      let shortName: string | null = null;
      let retrieved: ThemeQuote[] = [];

      setSteps([
        {
          key: 'moderate',
          label: '解析与审核人物',
          icon: <ShieldCheck className="h-4 w-4" />,
          run: async () => {
            const result = await moderatePersonInput(s);
            personName = result.personName ?? '';
            shortName = result.shortName;
            return `识别人物：「${personName}」· 审核通过`;
          },
        },
        {
          key: 'retrieve',
          label: '联网检索真实语录',
          icon: <Search className="h-4 w-4" />,
          run: async () => {
            // 候选名：shortName > 审核全名 > 用户输入关键词 > 名称变体（见 quoteSearch）
            const candidates = buildNameCandidates(personName, shortName, extractKeyword(s));
            const { quotes, usedName, viaProxy, unverified } = await searchQuotes(candidates);
            retrieved = quotes;
            // 宽松兜底（VITE_QUOTE_FALLBACK=llm）：联网检索全失败，凭大模型知识生成，
            // 必须如实标注「未经核验」，流水线以警告而非成功样式呈现
            if (unverified) {
              return { detail: '联网检索失败，已改用大模型生成（未经核验）', warn: true };
            }
            const base =
              usedName !== personName
                ? `以「${usedName}」从国内互联网检索到 ${quotes.length} 条`
                : `从国内互联网检索到 ${quotes.length} 条`;
            return viaProxy ? `${base}（服务端代理）` : base;
          },
        },
        {
          key: 'design',
          label: '大模型设计视觉主题',
          icon: <Bot className="h-4 w-4" />,
          run: async () => {
            const aiTheme = await designThemeWithLLM(personName, retrieved);
            resultRef.current = aiTheme;
            return modelLabel ? `「${aiTheme.name}」· ${modelLabel}` : `「${aiTheme.name}」`;
          },
        },
        {
          key: 'portrait',
          label: '生成人物画像',
          icon: <ImagePlus className="h-4 w-4" />,
          activeDetail: () => `正在绘制「${personName || '人物'}」的画像…`,
          run: async () => {
            // 画像失败不阻塞主题应用：降级为 emoji/默认标识
            const t = resultRef.current;
            if (!t?.portraitPrompt) return '画像生成失败，使用默认标识';
            try {
              const logo = await generatePortrait(t.portraitPrompt, personName);
              resultRef.current = { ...t, logo };
              return `「${personName}」的画像已生成`;
            } catch {
              toast.error('画像生成失败，已使用默认标识');
              return '画像生成失败，使用默认标识';
            }
          },
        },
        applyStep(),
      ]);
    }

    setRunning(true);
    setRunId((n) => n + 1);
  };

  const handleFinished = () => {
    const result = resultRef.current;
    if (result) {
      onThemeApplied(result);
    }
    setRunning(false);
  };

  const handleAbort = (error: Error) => {
    // 拒绝、失败、服务端限流均如实提示（不阻塞后续生成）
    if (error instanceof RefusalError) {
      toast.error(error.message);
    } else if (error instanceof LlmError && error.kind === 'rate-limit') {
      // 服务端代理的每 IP 防滥用限流（保护部署者的 API 额度）
      toast.error(error.message);
    } else {
      toast.error('生成失败，请稍后重试', { description: error.message });
    }
    setRunning(false);
  };

  return (
    <div className="w-full space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(input);
        }}
        className="flex w-full gap-2"
      >
        <div className="relative flex-1">
          <Wand2
            className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${
              isLightText ? 'text-white/70' : 'text-stone-400'
            }`}
          />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="告诉我你喜欢的人物，比如：我喜欢苏轼"
            disabled={running}
            className={`h-12 pl-9 shadow-lg backdrop-blur-md ${
              isLightText
                ? 'border-white/30 bg-black/25 text-white placeholder:text-white/60 focus-visible:ring-white/50'
                : 'border-white/60 bg-white/70 text-stone-800 placeholder:text-stone-400 focus-visible:ring-stone-400/50'
            }`}
          />
        </div>
        <Button
          type="submit"
          disabled={running || !input.trim()}
          className="h-12 gap-1.5 px-5 text-white shadow-md"
          style={{ backgroundColor: theme.primaryColor }}
        >
          <Sparkles className="h-4 w-4" />
          换主题
        </Button>
      </form>

      <div
        className={`flex flex-wrap items-center gap-2 text-xs ${
          isLightText ? 'text-white/80' : 'text-stone-500'
        }`}
      >
        <span className="opacity-80">快速体验：</span>
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={running}
            onClick={() => start(chip)}
            className={`rounded-full border px-3 py-1 backdrop-blur-md transition-colors disabled:opacity-50 ${
              isLightText
                ? 'border-white/30 bg-white/10 hover:bg-white/25'
                : 'border-stone-300/70 bg-white/50 text-stone-600 hover:bg-white/80'
            }`}
          >
            {chip}
          </button>
        ))}
      </div>

      <ThemePipeline
        runId={runId}
        steps={steps}
        onFinished={handleFinished}
        onAbort={handleAbort}
      />
    </div>
  );
}
