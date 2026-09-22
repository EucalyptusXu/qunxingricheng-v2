import { useState } from 'react';
import { Bell, BellRing, CalendarDays, Palette, Plus } from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { ThemeBackground } from '@/components/ThemeBackground';
import { QuoteCarousel } from '@/components/QuoteCarousel';
import { EventDialog } from '@/components/EventDialog';
import { glassCardClass } from '@/components/EventList';
import { ScheduleSection } from '@/sections/ScheduleSection';
import { ThemeSection } from '@/sections/ThemeSection';
import { useSchedule } from '@/hooks/useSchedule';
import { useReminders } from '@/hooks/useReminders';
import { builtinThemes, defaultTheme, presetGalleryThemes, resolveLogoSrc, type AppTheme } from '@/themes';
import type { ScheduleEvent } from '@/types/schedule';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function formatToday(): string {
  const d = new Date();
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${WEEKDAYS[d.getDay()]}`;
}

/** 支持 ?theme=<id> 直达内置主题，方便分享与演示 */
function initialTheme(): AppTheme {
  const id = new URLSearchParams(window.location.search).get('theme');
  return builtinThemes.find((t) => t.id === id) ?? defaultTheme;
}

type TabKey = 'schedule' | 'theme';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'schedule', label: '日程', icon: <CalendarDays className="h-4 w-4" /> },
  { key: 'theme', label: '主题定制', icon: <Palette className="h-4 w-4" /> },
];

/** 支持 ?tab=theme 直达主题定制页 */
function initialTab(): TabKey {
  return new URLSearchParams(window.location.search).get('tab') === 'theme'
    ? 'theme'
    : 'schedule';
}

export default function Home() {
  const [theme, setTheme] = useState<AppTheme>(initialTheme);
  // 主题画廊数据：3 位人物预设 + 本次会话中 AI 生成过的主题
  const [galleryThemes, setGalleryThemes] = useState<AppTheme[]>(presetGalleryThemes);
  const [tab, setTab] = useState<TabKey>(initialTab);

  const { events, addEvent, updateEvent, deleteEvent, toggleComplete, markReminded } =
    useSchedule();
  useReminders(events, markReminded);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  );

  const isLightText = theme.textOnBg === 'light';

  const handleThemeApplied = (t: AppTheme) => {
    setTheme((prevTheme) => {
      // 当前主题被换下且不进画廊（非同 id 的重复生成）时，回收其运行时画像 object URL
      if (
        prevTheme.logo?.startsWith('blob:') &&
        prevTheme.id !== t.id &&
        !galleryThemes.some((x) => x.id === prevTheme.id)
      ) {
        URL.revokeObjectURL(prevTheme.logo);
      }
      return t;
    });
    setGalleryThemes((prev) => {
      // 同 id 重复生成（同一人物重新生成）：替换旧卡并回收旧画像 object URL，避免泄漏
      const old = prev.find((x) => x.id === t.id);
      if (old?.logo?.startsWith('blob:') && old.logo !== t.logo) {
        URL.revokeObjectURL(old.logo);
      }
      return old ? prev.map((x) => (x.id === t.id ? t : x)) : [...prev, t];
    });
  };

  const requestNotification = async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  };

  return (
    <div
      className={`min-h-screen transition-colors ${isLightText ? 'text-white' : 'text-stone-800'}`}
      style={{ fontFamily: theme.fontStyle }}
    >
      <ThemeBackground theme={theme} />
      <Toaster position="top-center" richColors />

      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 px-4 py-6 md:py-10">
        {/* 共享头部：Logo、应用名 + 主题徽标、日期、语录轮播、通知授权 */}
        <header
          className={`rounded-3xl border p-5 shadow-lg backdrop-blur-md md:p-6 ${glassCardClass(theme)}`}
        >
          <div className="flex items-center gap-3">
            {theme.logo ? (
              <img
                src={resolveLogoSrc(theme.logo)}
                alt={`${theme.name} Logo`}
                className="h-12 w-12 shrink-0 rounded-full object-contain"
              />
            ) : (
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: theme.primaryColor }}
              >
                <CalendarDays className="h-6 w-6" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold tracking-wide md:text-2xl">
                群星日程
                <span className="ml-2 align-middle text-xs font-normal opacity-70">
                  {theme.name}
                </span>
              </h1>
              <p className="mt-0.5 text-xs opacity-75 md:text-sm">{formatToday()}</p>
            </div>
            {/* 通知授权：仅在浏览器支持且尚未决定时展示，拒绝后不打扰 */}
            {typeof Notification !== 'undefined' && notifPermission === 'default' && (
              <Button
                size="sm"
                variant="outline"
                onClick={requestNotification}
                className={`gap-1.5 border-current/30 bg-transparent ${
                  isLightText ? 'text-white hover:bg-white/15' : 'text-stone-700 hover:bg-white/40'
                }`}
              >
                <Bell className="h-4 w-4" />
                开启提醒
              </Button>
            )}
            {notifPermission === 'granted' && (
              <span className="flex items-center gap-1 text-xs opacity-70">
                <BellRing className="h-4 w-4" />
                提醒已开启
              </span>
            )}
          </div>
          <div className="mt-4 border-t border-current/10 pt-4">
            <QuoteCarousel theme={theme} />
          </div>
        </header>

        {/* 顶层标签导航：日程 / 主题定制 */}
        <nav
          className={`flex rounded-2xl border p-1.5 backdrop-blur-md ${
            isLightText ? 'border-white/25 bg-black/20' : 'border-white/50 bg-white/50'
          }`}
        >
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all ${
                  active
                    ? 'text-white shadow-md'
                    : isLightText
                      ? 'text-white/75 hover:text-white'
                      : 'text-stone-500 hover:text-stone-800'
                }`}
                style={active ? { backgroundColor: theme.primaryColor } : undefined}
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* 标签内容 */}
        <main className="flex-1">
          {tab === 'schedule' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold tracking-wide">我的日程</h2>
                <Button
                  onClick={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                  className="gap-1.5 text-white shadow-md"
                  style={{ backgroundColor: theme.primaryColor }}
                >
                  <Plus className="h-4 w-4" />
                  新建日程
                </Button>
              </div>
              <ScheduleSection
                events={events}
                theme={theme}
                onToggle={toggleComplete}
                onEdit={(ev) => {
                  setEditing(ev);
                  setDialogOpen(true);
                }}
                onDelete={deleteEvent}
              />
            </div>
          ) : (
            <ThemeSection
              theme={theme}
              galleryThemes={galleryThemes}
              onThemeApplied={handleThemeApplied}
            />
          )}
        </main>

        <footer className="pb-2 text-center text-xs opacity-60">
          群星日程 · 一句话，千人千面
        </footer>
      </div>

      <EventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={editing}
        onSubmit={(data) => {
          if (editing) {
            updateEvent(editing.id, data);
          } else {
            addEvent(data);
          }
        }}
      />
    </div>
  );
}
