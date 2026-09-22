import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  EventEmpty,
  EventItem,
  glassCardClass,
  type EventActionProps,
} from '@/components/EventList';
import { addDays, formatDateFull } from '@/lib/dateUtils';
import type { ScheduleEvent } from '@/types/schedule';

interface Props extends EventActionProps {
  events: ScheduleEvent[];
  date: string;
  onDateChange: (date: string) => void;
}

/** 日视图：前一天 / 后一天切换 + 日期选择，展示当日的简易时间线 */
export function DayView({
  events,
  date,
  onDateChange,
  theme,
  onToggle,
  onEdit,
  onDelete,
}: Props) {
  const dayEvents = useMemo(
    () =>
      events
        .filter((ev) => ev.date === date)
        .sort((a, b) => a.time.localeCompare(b.time)),
    [events, date],
  );

  const isLightText = theme.textOnBg === 'light';

  return (
    <div className="space-y-4">
      <div
        className={`flex items-center justify-between gap-2 rounded-2xl border p-3 backdrop-blur-md ${glassCardClass(theme)}`}
      >
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={() => onDateChange(addDays(date, -1))}
          aria-label="前一天"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-semibold md:text-base">
            {formatDateFull(date)}
          </p>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && onDateChange(e.target.value)}
            aria-label="选择日期"
            className={`mt-1 cursor-pointer rounded-md border bg-transparent px-2 py-0.5 text-xs outline-none ${
              isLightText
                ? 'border-white/30 text-white/80 [color-scheme:dark]'
                : 'border-stone-300 text-stone-500'
            }`}
          />
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={() => onDateChange(addDays(date, 1))}
          aria-label="后一天"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {dayEvents.length === 0 ? (
        <EventEmpty theme={theme} text="这一天还没有安排日程" />
      ) : (
        <ul className="space-y-2">
          {dayEvents.map((ev) => (
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
  );
}
