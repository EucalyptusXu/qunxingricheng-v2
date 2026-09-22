import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  EventItem,
  glassCardClass,
  type EventActionProps,
} from '@/components/EventList';
import { monthLabel, toDateString } from '@/lib/dateUtils';
import { todayString, type ScheduleEvent } from '@/types/schedule';

/** 周一开头的表头 */
const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];

interface Props extends EventActionProps {
  events: ScheduleEvent[];
  /** 当前展示的月份 */
  year: number;
  monthIndex: number; // 0-11
  onMonthChange: (year: number, monthIndex: number) => void;
  /** 选中的日期（下方展示当日日程） */
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

interface DayCell {
  date: string;
  dayOfMonth: number;
  count: number;
}

/** 月视图：周一开头的日历网格，事件以圆点/计数展示，点击日期在下方列出当日日程 */
export function MonthView({
  events,
  year,
  monthIndex,
  onMonthChange,
  selectedDate,
  onSelectDate,
  theme,
  onToggle,
  onEdit,
  onDelete,
}: Props) {
  const isLightText = theme.textOnBg === 'light';
  const today = todayString();

  // 日期 → 事件数
  const countByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const ev of events) {
      map.set(ev.date, (map.get(ev.date) ?? 0) + 1);
    }
    return map;
  }, [events]);

  // 构建网格：周一开头，补足整周
  const cells = useMemo<(DayCell | null)[]>(() => {
    const first = new Date(year, monthIndex, 1);
    // 周一为一周起点：周日(0) 需要偏移 6
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const result: (DayCell | null)[] = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = toDateString(new Date(year, monthIndex, d));
      result.push({ date, dayOfMonth: d, count: countByDate.get(date) ?? 0 });
    }
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [year, monthIndex, countByDate]);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, monthIndex + delta, 1);
    onMonthChange(d.getFullYear(), d.getMonth());
  };

  const selectedEvents = useMemo(
    () =>
      events
        .filter((ev) => ev.date === selectedDate)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [events, selectedDate],
  );

  const renderCell = (cell: DayCell | null, i: number) => {
    if (cell === null) return <div key={`blank-${i}`} />;
    const isToday = cell.date === today;
    const isSelected = cell.date === selectedDate;
    return (
      <button
        key={cell.date}
        type="button"
        onClick={() => onSelectDate(cell.date)}
        className={`flex min-h-[3rem] flex-col items-center justify-start rounded-lg px-0.5 py-1 text-sm transition-colors md:min-h-[3.5rem] ${
          isSelected ? 'ring-2' : isLightText ? 'hover:bg-white/15' : 'hover:bg-white/60'
        }`}
        style={
          isSelected
            ? { ['--tw-ring-color' as string]: theme.primaryColor }
            : undefined
        }
        aria-label={`${cell.dayOfMonth} 日，${cell.count} 项日程`}
      >
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full ${
            isToday ? 'font-bold text-white' : ''
          }`}
          style={isToday ? { backgroundColor: theme.primaryColor } : undefined}
        >
          {cell.dayOfMonth}
        </span>
        {/* 事件指示：最多 3 个圆点，更多则显示计数徽标 */}
        {cell.count > 0 && (
          <span className="mt-0.5 flex items-center gap-0.5">
            {cell.count <= 3 ? (
              Array.from({ length: cell.count }).map((_, d) => (
                <span
                  key={d}
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: theme.primaryColor }}
                />
              ))
            ) : (
              <span
                className="rounded-full px-1 text-[10px] leading-4 text-white"
                style={{ backgroundColor: theme.primaryColor }}
              >
                {cell.count}
              </span>
            )}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div
        className={`rounded-2xl border p-3 backdrop-blur-md md:p-4 ${glassCardClass(theme)}`}
      >
        {/* 月份导航 */}
        <div className="mb-3 flex items-center justify-between">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => shiftMonth(-1)}
            aria-label="上个月"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="text-sm font-semibold md:text-base">
            {monthLabel(year, monthIndex)}
          </p>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => shiftMonth(1)}
            aria-label="下个月"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* 星期表头（周一开头） */}
        <div className="grid grid-cols-7 gap-1 text-center text-xs opacity-70">
          {WEEKDAY_HEADERS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>

        {/* 日期网格 */}
        <div className="grid grid-cols-7 gap-1">{cells.map(renderCell)}</div>
      </div>

      {/* 选中日的日程 */}
      <div>
        <h3
          className={`mb-2 text-sm font-semibold tracking-wide ${
            isLightText ? 'text-white/85' : 'text-stone-600'
          }`}
        >
          {selectedDate === today ? '今天' : `${Number(selectedDate.slice(8))} 日`}
          的日程
          {selectedEvents.length > 0 && `（${selectedEvents.length} 项）`}
        </h3>
        {selectedEvents.length === 0 ? (
          <p className={`text-sm ${isLightText ? 'text-white/60' : 'text-stone-400'}`}>
            这一天没有日程
          </p>
        ) : (
          <ul className="space-y-2">
            {selectedEvents.map((ev) => (
              <EventItem
                key={ev.id}
                ev={ev}
                theme={theme}
                onToggle={onToggle}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
