import { HeroSection } from '@/sections/HeroSection';
import { ThemeGallery } from '@/components/ThemeGallery';
import type { AppTheme } from '@/themes';

interface Props {
  theme: AppTheme;
  /** 内置主题 + 本次会话动态生成的主题 */
  galleryThemes: AppTheme[];
  onThemeApplied: (theme: AppTheme) => void;
}

/** 主题定制页：一句话换主题 + 主题画廊（AI 接口由部署方服务端配置，访客零设置） */
export function ThemeSection({ theme, galleryThemes, onThemeApplied }: Props) {
  return (
    <div className="space-y-6">
      <HeroSection theme={theme} onThemeApplied={onThemeApplied} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-wide">主题画廊</h2>
        <ThemeGallery
          themes={galleryThemes}
          activeTheme={theme}
          onApply={onThemeApplied}
        />
      </section>
    </div>
  );
}
