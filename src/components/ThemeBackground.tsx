import { useEffect, useState } from 'react';
import type { AppTheme } from '@/themes';

const FADE_MS = 1000;

function layerStyle(theme: AppTheme): React.CSSProperties {
  if (theme.backgroundImage) {
    return {
      backgroundImage: `url(${import.meta.env.BASE_URL}${theme.backgroundImage})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return { backgroundImage: theme.gradient };
}

/**
 * 全屏主题背景：主题切换时新背景淡入、旧背景淡出（crossfade），
 * 并叠加一层蒙版保证前景文字可读。
 */
export function ThemeBackground({ theme }: { theme: AppTheme }) {
  // layers[0] 是正在淡出的旧主题，layers[1] 是正在淡入的新主题
  const [layers, setLayers] = useState<AppTheme[]>([theme]);

  useEffect(() => {
    setLayers((prev) => {
      if (prev[prev.length - 1].id === theme.id) return prev;
      return [prev[prev.length - 1], theme];
    });
    const timer = setTimeout(() => {
      setLayers((prev) => (prev.length > 1 ? [prev[prev.length - 1]] : prev));
    }, FADE_MS + 100);
    return () => clearTimeout(timer);
  }, [theme]);

  const isLightText = theme.textOnBg === 'light';

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {layers.map((t, i) => {
        const isTop = i === layers.length - 1;
        return (
          <div
            key={t.id}
            className="absolute inset-0 transition-opacity"
            style={{
              ...layerStyle(t),
              opacity: isTop ? 1 : 1,
              zIndex: i,
              transitionDuration: `${FADE_MS}ms`,
              // 最顶层从透明淡入
              animation: isTop && layers.length > 1 ? `themeFadeIn ${FADE_MS}ms ease both` : undefined,
            }}
          />
        );
      })}
      {/* AI 生成主题的 emoji 水印装饰（低透明度，蒙版之下） */}
      {theme.emoji && (
        <div
          className="pointer-events-none absolute -bottom-12 -right-8 select-none text-[14rem] leading-none opacity-15 md:text-[20rem]"
          style={{ zIndex: layers.length }}
        >
          {theme.emoji}
        </div>
      )}
      {/* 可读性蒙版：浅色文字主题压暗背景，深色文字主题提亮背景 */}
      <div
        className={`absolute inset-0 transition-colors duration-1000 ${
          isLightText ? 'bg-black/45' : 'bg-white/25'
        }`}
        style={{ zIndex: layers.length }}
      />
      <style>{`@keyframes themeFadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}
