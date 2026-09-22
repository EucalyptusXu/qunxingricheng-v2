import { useState } from 'react';
import { CalendarDays, CalendarRange, Calendar, List } from 'lucide-react';
import { EventList, type EventActionProps } from '@/components/EventList';
import { DayView } from '@/components/DayView';
import { MonthView } from '@/components/MonthView';
import { YearView } from '@/components/YearView';
import { todayString, type ScheduleEvent } from '@/types/schedule';

type ScheduleView = 'list' | 'day' | 'month' | 'year';

const VIEWS: { key: ScheduleView; label: string; icon: React.ReactNode }[] = [
  { key: 'list', label: '列表', icon: <List className="h-3.5 w-3.5" /> },
  { key: 'day', label: '日', icon: <Calendar className="h-3.5 w-3.5" /> },
  { key: 'month', label: '月', icon: <CalendarDays className="h-3.5 w-3.5" /> },
  { key: 'year', label: '年', icon: <CalendarRange className="h-3.5 w-3.5" /> },
];

interface Props extends EventActionProps {
  events: ScheduleEvent[];
}

/** 支持 ?view=day|month|year 直达指定视图 */
function initialView(): ScheduleView {
  const v = new URLSearchParams(window.location.search).get('view');
  return v === 'day' || v === 'month' || v === 'year' ? v : 'list';
}

/** 日程区：列表 / 日 / 月 / 年 四种视图，共享同一份 useSchedule 数据 */
export function ScheduleSection({ events, theme, onToggle, onEdit, onDelete }: Props) {
  const [view, setView] = useState<ScheduleView>(initialView);
  const [selectedDate, setSelectedDate] = useState(todayString());
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [yearViewYear, setYearViewYear] = useState(now.getFullYear());

  const isLightText = theme.textOnBg === 'light';

  const actionProps: EventActionProps = { theme, onToggle, onEdit, onDelete };

  return (
    <div className="space-y-4">
      {/* 视图切换（分段控件，配色跟随主题） */}
      <div
        className={`inline-flex rounded-full border p-1 backdrop-blur-md ${
          isLightText ? 'border-white/25 bg-black/20' : 'border-white/50 bg-white/50'
        }`}
      >
        {VIEWS.map((v) => {
          const active = view === v.key;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all md:px-4 md:text-sm ${
                active
                  ? 'text-white shadow'
                  : isLightText
                    ? 'text-white/75 hover:text-white'
                    : 'text-stone-500 hover:text-stone-800'
              }`}
              style={active ? { backgroundColor: theme.primaryColor } : undefined}
            >
              {v.icon}
              {v.label}
            </button>
          );
        })}
      </div>

      {view === 'list' && <EventList events={events} {...actionProps} />}

      {view === 'day' && (
        <DayView
          events={events}
          date={selectedDate}
          onDateChange={setSelectedDate}
          {...actionProps}
        />
      )}

      {view === 'month' && (
        <MonthView
          events={events}
          year={calYear}
          monthIndex={calMonth}
          onMonthChange={(y, m) => {
            setCalYear(y);
            setCalMonth(m);
          }}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          {...actionProps}
        />
      )}

      {view === 'year' && (
        <YearView
          events={events}
          theme={theme}
          year={yearViewYear}
          onYearChange={setYearViewYear}
          onSelectMonth={(y, m) => {
            setCalYear(y);
            setCalMonth(m);
            setView('month');
          }}
        />
      )}
    </div>
  );
}
