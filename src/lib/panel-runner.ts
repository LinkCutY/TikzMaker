export type PanelState<T> = {
  index: number;
  status: "pending" | "running" | "ok" | "fail";
  attempts: number;
  value?: T;
  error?: string;
};

/** One deadline for the whole image. Each completed result is published at once. */
export async function runPanelJobs<T>(options: {
  count: number;
  run: (index: number, context: { signal: AbortSignal; budgetMs: number; strict: boolean; attempt: number }) => Promise<T>;
  initial?: Map<number, T>;
  onUpdate?: (states: PanelState<T>[]) => void;
  signal?: AbortSignal;
  budgetMs?: number;
  panelBudgetMs?: number;
  concurrency?: number;
  maxAttempts?: number;
}) {
  const started = Date.now();
  const deadline = started + (options.budgetMs ?? 180_000);
  const control = new AbortController();
  const stop = () => control.abort(options.signal?.reason ?? new Error("识别已取消"));
  if (options.signal?.aborted) stop();
  else options.signal?.addEventListener("abort", stop, { once: true });
  const clock = setTimeout(() => control.abort(new Error("整张图达到时间上限")), Math.max(1, deadline - Date.now()));
  const states: PanelState<T>[] = Array.from({ length: options.count }, (_, index) => options.initial?.has(index)
    ? { index, status: "ok", attempts: 0, value: options.initial.get(index) }
    : { index, status: "pending", attempts: 0 });
  const publish = () => options.onUpdate?.(states.map(s => ({ ...s })));
  const queue = states.filter(s => s.status === "pending").map(s => s.index);
  publish();
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 2, queue.length)) }, async () => {
      while (queue.length && !control.signal.aborted) {
        const index = queue.shift()!;
        const state = states[index];
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        state.attempts++;
        state.status = "running";
        publish();
        const child = new AbortController();
        const abort = () => child.abort(control.signal.reason);
        control.signal.addEventListener("abort", abort, { once: true });
        const budgetMs = Math.max(1, Math.min(options.panelBudgetMs ?? 75_000, remaining));
        const timer = setTimeout(() => child.abort(new Error("此面板达到时间上限")), budgetMs);
        let onAbort: (() => void) | undefined;
        try {
          const cancelled = new Promise<never>((_, reject) => {
            onAbort = () => reject(child.signal.reason ?? new Error("识别已取消"));
            child.signal.addEventListener("abort", onAbort, { once: true });
            if (child.signal.aborted) onAbort();
          });
          state.value = await Promise.race([options.run(index, { signal: child.signal, budgetMs, strict: state.attempts > 1, attempt: state.attempts }), cancelled]);
          state.status = "ok";
          state.error = undefined;
        } catch (err) {
          const e = err as Error & { code?: string; status?: number };
          state.status = "fail";
          state.error = e.message || "识别失败";
          const fatal = /BAD_KEY|NO_BALANCE|BAD_MODEL/.test(e.code ?? "") || /401|402|403|余额|API key|supported API model/i.test(state.error);
          if (fatal) control.abort(e);
          if (!fatal && !control.signal.aborted && state.attempts < (options.maxAttempts ?? 2) && deadline - Date.now() > 10_000) {
            state.status = "pending";
            queue.push(index);
          }
        } finally {
          clearTimeout(timer);
          control.signal.removeEventListener("abort", abort);
          if (onAbort) child.signal.removeEventListener("abort", onAbort);
          publish();
        }
      }
    }));
  } finally {
    clearTimeout(clock);
    options.signal?.removeEventListener("abort", stop);
    for (const state of states) if (state.status === "pending" || state.status === "running") {
      state.status = "fail";
      state.error = control.signal.reason?.message ?? "未完成";
    }
    publish();
  }
  return { states, durationMs: Date.now() - started, cancelled: Boolean(options.signal?.aborted), timedOut: Date.now() >= deadline };
}
