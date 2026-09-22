import { useCallback, useEffect, useState } from 'react';
import type { ScheduleEvent } from '@/types/schedule';

const STORAGE_KEY = 'qunxing-schedule-events-v1';
/** 品牌更名迁移：旧 key（千面日程）存在且新 key 不存在时拷贝过来，不丢用户已有日程 */
const LEGACY_STORAGE_KEY = 'qianmian-schedule-events-v1';

function loadEvents(): ScheduleEvent[] {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        localStorage.setItem(STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        raw = legacy;
      }
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScheduleEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 演示模式：URL 带 ?demo=1 且本地尚无数据时，注入一组示例日程，
 * 方便首次打开 / 截图演示时直观看到各视图效果。
 */
function demoEvents(): ScheduleEvent[] | null {
  if (!new URLSearchParams(window.location.search).has('demo')) return null;
  if (localStorage.getItem(STORAGE_KEY)) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date();
  const plus = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return fmt(d);
  };
  const make = (
    title: string,
    date: string,
    time: string,
    note: string | undefined,
    reminder: ScheduleEvent['reminder'],
  ): ScheduleEvent => ({
    id: crypto.randomUUID(),
    title,
    date,
    time,
    note,
    reminder,
    completed: false,
    reminded: false,
    createdAt: Date.now(),
  });
  return [
    make('晨会同步', fmt(today), '09:30', '同步本周迭代进度', '5'),
    make('读《传习录》30 分钟', fmt(today), '14:00', '知行合一，事上磨练', '0'),
    make('项目评审会', plus(1), '10:00', '准备演示文稿', '15'),
    make('健身 · 有氧 40 分钟', plus(3), '19:00', undefined, 'none'),
    make('朋友聚餐', plus(7), '18:30', '老地方，提前订位', '15'),
    make('季度总结提交', plus(20), '17:00', undefined, '0'),
  ];
}

/** 日程事件的增删改查，自动持久化到 localStorage */
export function useSchedule() {
  const [events, setEvents] = useState<ScheduleEvent[]>(
    () => demoEvents() ?? loadEvents(),
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }, [events]);

  const addEvent = useCallback(
    (data: Omit<ScheduleEvent, 'id' | 'completed' | 'reminded' | 'createdAt'>) => {
      const ev: ScheduleEvent = {
        ...data,
        id: crypto.randomUUID(),
        completed: false,
        reminded: false,
        createdAt: Date.now(),
      };
      setEvents((prev) => [...prev, ev]);
      return ev;
    },
    [],
  );

  const updateEvent = useCallback((id: string, patch: Partial<ScheduleEvent>) => {
    setEvents((prev) =>
      prev.map((ev) => {
        if (ev.id !== id) return ev;
        const next = { ...ev, ...patch };
        // 时间或提醒策略变化后，允许重新触发提醒
        if (
          patch.date !== undefined ||
          patch.time !== undefined ||
          patch.reminder !== undefined
        ) {
          next.reminded = false;
        }
        return next;
      }),
    );
  }, []);

  const deleteEvent = useCallback((id: string) => {
    setEvents((prev) => prev.filter((ev) => ev.id !== id));
  }, []);

  const toggleComplete = useCallback((id: string) => {
    setEvents((prev) =>
      prev.map((ev) => (ev.id === id ? { ...ev, completed: !ev.completed } : ev)),
    );
  }, []);

  const markReminded = useCallback((id: string) => {
    setEvents((prev) =>
      prev.map((ev) => (ev.id === id ? { ...ev, reminded: true } : ev)),
    );
  }, []);

  return { events, addEvent, updateEvent, deleteEvent, toggleComplete, markReminded };
}
