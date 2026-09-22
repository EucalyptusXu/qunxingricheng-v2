import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  REMINDER_LABELS,
  nowTimeString,
  todayString,
  type ReminderOption,
  type ScheduleEvent,
} from '@/types/schedule';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入则为编辑模式，否则为新建 */
  event?: ScheduleEvent | null;
  onSubmit: (data: {
    title: string;
    date: string;
    time: string;
    note?: string;
    reminder: ReminderOption;
  }) => void;
}

/** 新建 / 编辑日程的对话框表单 */
export function EventDialog({ open, onOpenChange, event, onSubmit }: Props) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayString());
  const [time, setTime] = useState(nowTimeString());
  const [note, setNote] = useState('');
  const [reminder, setReminder] = useState<ReminderOption>('0');

  // 打开时根据新建 / 编辑初始化表单
  useEffect(() => {
    if (!open) return;
    setTitle(event?.title ?? '');
    setDate(event?.date ?? todayString());
    setTime(event?.time ?? nowTimeString());
    setNote(event?.note ?? '');
    setReminder(event?.reminder ?? '0');
  }, [open, event]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    onSubmit({
      title: title.trim(),
      date,
      time: time || '09:00',
      note: note.trim() || undefined,
      reminder,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{event ? '编辑日程' : '新建日程'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ev-title">标题</Label>
            <Input
              id="ev-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="要做什么？"
              autoFocus
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ev-date">日期</Label>
              <Input
                id="ev-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-time">时间</Label>
              <Input
                id="ev-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>提醒</Label>
            <Select value={reminder} onValueChange={(v) => setReminder(v as ReminderOption)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REMINDER_LABELS) as ReminderOption[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {REMINDER_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-note">备注（可选）</Label>
            <Textarea
              id="ev-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="补充一些细节……"
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">{event ? '保存修改' : '添加日程'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
