import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { glassCardClass } from '@/components/EventList';
import type { AppTheme } from '@/themes';
import type { ScheduleEvent } from '@/types/schedule';

const MONTH_NAMES = [
  '1 月', '2 月', '3 月', '4 月', '5 月', '6 月',
  '7 月', '8 月', '9 月', '10 月', '11 月', '12 月',
];

interface Props {
  events: ScheduleEvent[];
  theme: AppTheme;
  year: number;
  onYearChange: (year: number) => void;
  /** 点击月份卡片 → 跳转到该月的月视图 */
  onSelectMonth: (year: number, monthIndex: number) => void;
}

/** 年视图：12 个月份卡片，展示每月日程数量，有日程的月份高亮 */
export function YearView({ events, theme, year, onYearChange, onSelectMonth }: Props) {
  const isLightText = theme.textOnBg === 'light';
  const now = new Date();

  // 月份（yyyy-mm）→ 事件数
  const countByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of events) {
      const key = ev.date.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [events]);

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="space-y-4">
      <div
        className={`flex items-center justify-between rounded-2xl border p-3 backdrop-blur-md ${glassCardClass(theme)}`}
      >
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => onYearChange(year - 1)}
          aria-label="上一年"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="text-sm font-semibold md:text-base">{year} 年</p>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => onYearChange(year + 1)}
          aria-label="下一年"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {MONTH_NAMES.map((name, i) => {
          const count = countByMonth.get(`${year}-${pad(i + 1)}`) ?? 0;
          const isCurrentMonth = year === now.getFullYear() && i === now.getMonth();
          return (
            <button
              key={name}
              type="button"
              onClick={() => onSelectMonth(year, i)}
              className={`flex flex-col items-start gap-1 rounded-2xl border p-3.5 text-left backdrop-blur-md transition-all hover:-translate-y-0.5 ${
                isLightText
                  ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
                  : 'border-white/50 bg-white/60 text-stone-800 hover:bg-white/80'
              }`}
              style={
                count > 0
                  ? { borderColor: theme.primaryColor, boxShadow: `0 0 0 1px ${theme.primaryColor}` }
                  : undefined
              }
            >
              <span className="flex w-full items-center justify-between">
                <span className="font-semibold">{name}</span>
                {isCurrentMonth && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] leading-none text-white"
                    style={{ backgroundColor: theme.primaryColor }}
                  >
                    本月
                  </span>
                )}
              </span>
              <span
                className={`text-xs ${count > 0 ? '' : 'opacity-50'}`}
                style={count > 0 ? { color: isLightText ? '#fff' : theme.primaryColor } : undefined}
              >
                {count > 0 ? `${count} 项日程` : '无日程'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
