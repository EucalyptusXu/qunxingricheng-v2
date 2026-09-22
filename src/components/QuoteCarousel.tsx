import { useEffect, useState } from 'react';
import { Quote, RefreshCw } from 'lucide-react';
import type { AppTheme } from '@/themes';

const FADE_MS = 300;

/**
 * 头部语录展示：不再自动轮播，点击「换一句」手动切换下一条，
 * 带短暂淡入淡出过渡；主题切换时重置为新主题的第一条。
 */
export function QuoteCarousel({ theme }: { theme: AppTheme }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  // 主题切换后回到第一条语录
  useEffect(() => {
    setIndex(0);
    setVisible(true);
  }, [theme.id]);

  const next = () => {
    if (theme.quotes.length <= 1) return;
    setVisible(false);
    setTimeout(() => {
      setIndex((i) => (i + 1) % theme.quotes.length);
      setVisible(true);
    }, FADE_MS);
  };

  const quote = theme.quotes[index % theme.quotes.length];
  if (!quote) return null;

  const isLightText = theme.textOnBg === 'light';

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-h-[3.5rem] min-w-0 flex-1 items-start gap-2">
        <Quote className="mt-1 h-4 w-4 shrink-0 opacity-60" />
        <figure
          className="min-w-0 transition-opacity ease-in-out"
          style={{ opacity: visible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
        >
          <blockquote className="text-sm leading-relaxed md:text-base">
            {quote.text}
          </blockquote>
          <figcaption className="mt-1 text-xs opacity-70">—— {quote.source}</figcaption>
          {quote.unverified && (
            <span
              className={`mt-1 inline-block w-fit rounded border px-1.5 py-0.5 text-[10px] ${
                isLightText
                  ? 'border-amber-300/50 text-amber-200'
                  : 'border-amber-600/50 text-amber-700'
              }`}
            >
              语录未经联网核验
            </span>
          )}
        </figure>
      </div>
      {theme.quotes.length > 1 && (
        <button
          type="button"
          onClick={next}
          className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs backdrop-blur-md transition-colors ${
            theme.textOnBg === 'light'
              ? 'border-white/25 bg-white/10 text-white/80 hover:bg-white/25 hover:text-white'
              : 'border-stone-300/70 bg-white/40 text-stone-500 hover:bg-white/70 hover:text-stone-800'
          }`}
          aria-label="换一句语录"
        >
          <RefreshCw className="h-3 w-3" />
          换一句
        </button>
      )}
    </div>
  );
}
