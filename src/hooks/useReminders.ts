import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { ScheduleEvent } from '@/types/schedule';
import { reminderDateTime } from '@/types/schedule';

const CHECK_INTERVAL_MS = 15_000;

/**
 * 提醒引擎：每 15 秒扫描一次所有事件，
 * 到达提醒时刻且未触发过时，同时发出浏览器 Notification 和应用内 toast。
 * 触发后调用 markReminded，保证同一事件不重复提醒。
 */
export function useReminders(
  events: ScheduleEvent[],
  markReminded: (id: string) => void,
) {
  // 用 ref 持有最新数据，避免 interval 闭包捕获旧值
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const markRef = useRef(markReminded);
  markRef.current = markReminded;

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const ev of eventsRef.current) {
        if (ev.completed || ev.reminded || ev.reminder === 'none') continue;
        const at = reminderDateTime(ev);
        if (!at) continue;
        if (now >= at.getTime()) {
          const body = `${ev.date} ${ev.time} · ${ev.title}`;
          // 浏览器通知（已授权时）
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              new Notification('群星日程 · 日程提醒', { body });
            } catch {
              // 某些环境（如非安全上下文）构造 Notification 会抛错，忽略即可
            }
          }
          // 应用内 toast 兜底，保证任何情况下用户都能收到提醒
          toast('日程提醒', { description: body });
          markRef.current(ev.id);
        }
      }
    };

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
