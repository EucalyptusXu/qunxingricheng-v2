import { Check, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { glassCardClass } from '@/components/EventList';
import { resolveLogoSrc, type AppTheme } from '@/themes';

interface Props {
  /** 内置主题 + 本次会话动态生成的主题 */
  themes: AppTheme[];
  activeTheme: AppTheme;
  onApply: (theme: AppTheme) => void;
}

function swatchStyle(theme: AppTheme): React.CSSProperties {
  if (theme.backgroundImage) {
    return {
      backgroundImage: `url(${import.meta.env.BASE_URL}${theme.backgroundImage})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return { backgroundImage: theme.gradient };
}

/** 主题画廊：每个主题一张迷你预览卡（背景色板 / 强调色 / 示例语录 / 应用按钮） */
export function ThemeGallery({ themes, activeTheme, onApply }: Props) {
  const isLightText = activeTheme.textOnBg === 'light';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {themes.map((t) => {
        const active = t.id === activeTheme.id;
        return (
          <div
            key={t.id}
            className={`overflow-hidden rounded-2xl border backdrop-blur-md transition-all ${glassCardClass(activeTheme)}`}
            style={active ? { boxShadow: `0 0 0 2px ${activeTheme.primaryColor}` } : undefined}
          >
            {/* 迷你背景预览 */}
            <div className="relative h-20 w-full" style={swatchStyle(t)}>
              {t.logo && (
                <img
                  src={resolveLogoSrc(t.logo)}
                  alt=""
                  className="absolute bottom-2 left-3 h-8 w-8 rounded-full bg-white/70 object-contain p-0.5"
                />
              )}
              {active && (
                <span
                  className="absolute right-2 top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-white"
                  style={{ backgroundColor: t.primaryColor }}
                >
                  <Check className="h-3 w-3" />
                  使用中
                </span>
              )}
            </div>
            <div className="space-y-2 p-3.5">
              <div className="flex items-center gap-2">
                <span
                  className="h-3.5 w-3.5 rounded-full border border-white/40"
                  style={{ backgroundColor: t.primaryColor }}
                  title={`强调色 ${t.primaryColor}`}
                />
                <span className="font-semibold">
                  {t.emoji && <span className="mr-1">{t.emoji}</span>}
                  {t.name}
                </span>
                {t.generated && (
                  <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] opacity-70">
                    {t.id.startsWith('ai-') ? 'AI 生成' : '本地生成'}
                  </span>
                )}
                {t.quotes.some((q) => q.unverified) && (
                  <span className="rounded-full border border-amber-400/50 px-1.5 py-0.5 text-[10px] text-amber-500">
                    未核验
                  </span>
                )}
              </div>
              <p
                className={`flex items-start gap-1 text-xs leading-relaxed ${
                  isLightText ? 'text-white/70' : 'text-stone-500'
                }`}
              >
                <Quote className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
                <span className="line-clamp-2">{t.quotes[0]?.text}</span>
              </p>
              <Button
                size="sm"
                disabled={active}
                onClick={() => onApply(t)}
                className="w-full text-white"
                style={{ backgroundColor: t.primaryColor }}
              >
                {active ? '当前主题' : '应用'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
