import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, XCircle } from 'lucide-react';

/**
 * 步骤完成结果：纯字符串 = 正常完成详情；
 * { detail, warn: true } = 完成但需警示（如宽松兜底「未经核验」），
 * 显示琥珀色警告图标而非绿色对勾。
 */
export type StepOutcome = string | { detail: string; warn?: boolean };

/**
 * 流水线步骤定义：label 是阶段名，run 是真正执行的任务，
 * 返回的字符串作为该阶段完成后的详情文案。
 * 步骤抛出异常时流水线在该步标记失败并中止（调用 onAbort）。
 */
export interface PipelineStepDef {
  key: string;
  label: string;
  icon: React.ReactNode;
  run: () => Promise<StepOutcome>;
  /** 步骤进行中显示的详情（函数闭包可读取流水线中间结果） */
  activeDetail?: () => string;
}

type StepStatus = 'pending' | 'active' | 'done' | 'failed';

interface Props {
  /** 每次运行递增；0 表示空闲 */
  runId: number;
  steps: PipelineStepDef[];
  /** 全部步骤完成后回调（此时步骤闭包中的结果已就绪） */
  onFinished: () => void;
  /** 某一步抛错导致中止时回调（错误信息会显示在该步详情中） */
  onAbort: (error: Error) => void;
}

/**
 * 主题生成流水线：依次执行各阶段任务并实时反馈进度——
 * 阶段处于 loading 直到其 run() 真正 resolve，不做假定时器；
 * 任一步失败即中止，后续步骤不再执行。
 */
export function ThemePipeline({ runId, steps, onFinished, onAbort }: Props) {
  const [statuses, setStatuses] = useState<StepStatus[]>([]);
  const [details, setDetails] = useState<string[]>([]);
  const [warns, setWarns] = useState<boolean[]>([]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (runId === 0 || steps.length === 0) return;
    cancelledRef.current = false;
    setStatuses(steps.map((_, i) => (i === 0 ? 'active' : 'pending')));
    setDetails(steps.map(() => ''));
    setWarns(steps.map(() => false));

    (async () => {
      for (let i = 0; i < steps.length; i++) {
        let detail = '';
        let warn = false;
        try {
          const out = await steps[i].run();
          if (typeof out === 'string') {
            detail = out;
          } else {
            detail = out.detail;
            warn = !!out.warn;
          }
        } catch (e) {
          // 任一步失败：标记失败、中止流水线
          if (cancelledRef.current) return;
          const err = e instanceof Error ? e : new Error(String(e));
          setDetails((prev) => prev.map((d, j) => (j === i ? err.message : d)));
          setStatuses((prev) => prev.map((s, j) => (j === i ? 'failed' : s)));
          onAbort(err);
          return;
        }
        if (cancelledRef.current) return;
        setDetails((prev) => prev.map((d, j) => (j === i ? detail : d)));
        setWarns((prev) => prev.map((w, j) => (j === i ? warn : w)));
        setStatuses((prev) =>
          prev.map((s, j) => (j === i ? 'done' : j === i + 1 ? 'active' : s)),
        );
      }
      if (!cancelledRef.current) onFinished();
    })();

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  if (runId === 0 || steps.length === 0) return null;

  return (
    <div className="w-full rounded-2xl border border-white/30 bg-black/25 p-4 text-white shadow-lg backdrop-blur-md">
      <p className="mb-3 text-xs font-medium tracking-wide opacity-80">
        群星引擎 · 正在为你定制主题
      </p>
      <ol className="space-y-2.5">
        {steps.map((step, i) => {
          const status = statuses[i] ?? 'pending';
          const warn = status === 'done' && (warns[i] ?? false);
          return (
            <li key={step.key} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  warn
                    ? 'border-amber-300 bg-amber-400/30'
                    : status === 'done'
                    ? 'border-emerald-300 bg-emerald-400/30'
                    : status === 'failed'
                      ? 'border-red-300 bg-red-400/30'
                      : status === 'active'
                        ? 'border-white/70 bg-white/15'
                        : 'border-white/25 bg-white/5 opacity-50'
                }`}
              >
                {warn ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
                ) : status === 'done' ? (
                  <Check className="h-3.5 w-3.5 text-emerald-200" />
                ) : status === 'failed' ? (
                  <XCircle className="h-3.5 w-3.5 text-red-200" />
                ) : status === 'active' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  step.icon
                )}
              </span>
              <span className={status === 'pending' ? 'opacity-50' : ''}>
                {step.label}
              </span>
              {(status === 'done' || status === 'failed') && details[i] && (
                <span
                  className={`ml-auto max-w-[55%] truncate pl-2 text-xs ${
                    status === 'failed'
                      ? 'text-red-200 opacity-90'
                      : warn
                        ? 'text-amber-200 opacity-90'
                        : 'opacity-75'
                  }`}
                  title={details[i]}
                >
                  {details[i]}
                </span>
              )}
              {status === 'active' && step.activeDetail && (
                <span className="ml-auto max-w-[55%] truncate pl-2 text-xs opacity-75">
                  {step.activeDetail()}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
