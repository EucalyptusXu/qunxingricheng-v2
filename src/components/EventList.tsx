import { useMemo } from 'react';
import { Bell, BellOff, CalendarClock, Pencil, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  REMINDER_LABELS,
  todayString,
  type ScheduleEvent,
} from '@/types/schedule';
import type { AppTheme } from '@/themes';

export interface EventActionProps {
  theme: AppTheme;
  onToggle: (id: string) => void;
  onEdit: (event: ScheduleEvent) => void;
  onDelete: (id: string) => void;
}

/** 玻璃拟态卡片样式（按主题明暗切换），供各视图复用 */
export function glassCardClass(theme: AppTheme): string {
  return theme.textOnBg === 'light'
    ? 'border-white/20 bg-white/10 text-white'
    : 'border-white/50 bg-white/60 text-stone-800';
}

/** 单个日程条目：完成勾选、时间徽标、提醒、备注、编辑/删除 */
export function EventItem({
  ev,
  theme,
  onToggle,
  onEdit,
  onDelete,
}: EventActionProps & { ev: ScheduleEvent }) {
  return (
    <li
      className={`group flex items-start gap-3 rounded-2xl border p-3.5 shadow-sm backdrop-blur-md transition-colors ${glassCardClass(theme)}`}
    >
      <Checkbox
        checked={ev.completed}
        onCheckedChange={() => onToggle(ev.id)}
        className="mt-1"
        aria-label="标记完成"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-medium ${ev.completed ? 'opacity-50 line-through' : ''}`}>
            {ev.title}
          </span>
          <Badge
            variant="secondary"
            className="text-xs text-white"
            style={{ backgroundColor: theme.primaryColor }}
          >
            {ev.time}
          </Badge>
          {ev.reminder !== 'none' ? (
            <span className="flex items-center gap-1 text-xs opacity-70">
              <Bell className="h-3 w-3" />
              {REMINDER_LABELS[ev.reminder]}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs opacity-40">
              <BellOff className="h-3 w-3" />
              不提醒
            </span>
          )}
        </div>
        {ev.note && (
          <p
            className={`mt-1 text-sm ${
              ev.completed ? 'opacity-40 line-through' : 'opacity-75'
            }`}
          >
            {ev.note}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => onEdit(ev)}
          aria-label="编辑"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-red-500 hover:text-red-600"
          onClick={() => onDelete(ev.id)}
          aria-label="删除"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

/** 空状态提示 */
export function EventEmpty({ theme, text }: { theme: AppTheme; text: string }) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-2xl border p-10 text-sm backdrop-blur-md ${
        theme.textOnBg === 'light'
          ? 'border-white/20 bg-white/10 text-white/80'
          : 'border-white/40 bg-white/50 text-stone-500'
      }`}
    >
      <CalendarClock className="h-8 w-8 opacity-60" />
      {text}
    </div>
  );
}

interface EventGroup {
  label: string;
  events: ScheduleEvent[];
}

function tomorrowString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateLabel(date: string): string {
  if (date === todayString()) return '今天';
  if (date === tomorrowString()) return '明天';
  const d = new Date(`${date}T00:00:00`);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${weekdays[d.getDay()]}`;
}

/** 列表视图：按日期分组（今天 / 明天 / 未来日期），最近的排最前，展示全部日程 */
export function EventList({
  events,
  theme,
  onToggle,
  onEdit,
  onDelete,
}: EventActionProps & { events: ScheduleEvent[] }) {
  const groups = useMemo<EventGroup[]>(() => {
    const sorted = [...events].sort((a, b) =>
      `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`),
    );
    const map = new Map<string, ScheduleEvent[]>();
    for (const ev of sorted) {
      const list = map.get(ev.date) ?? [];
      list.push(ev);
      map.set(ev.date, list);
    }
    return [...map.entries()].map(([date, list]) => ({
      label: dateLabel(date),
      events: list,
    }));
  }, [events]);

  const isLightText = theme.textOnBg === 'light';

  if (events.length === 0) {
    return (
      <EventEmpty theme={theme} text="还没有日程，点击右上角「新建日程」开始规划吧" />
    );
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.label}>
          <h3
            className={`mb-2 text-sm font-semibold tracking-wide ${
              isLightText ? 'text-white/85' : 'text-stone-600'
            }`}
          >
            {group.label}
          </h3>
          <ul className="space-y-2">
            {group.events.map((ev) => (
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
        </section>
      ))}
    </div>
  );
}
