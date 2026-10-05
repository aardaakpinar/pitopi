export interface ScheduledTask {
  name: string;
  intervalMs: number;
  run: () => void | Promise<void>;
}

/** Runs tasks on fixed intervals; a failing task never stops the others. */
export function startScheduler(
  tasks: ScheduledTask[],
  onError: (name: string, err: unknown) => void,
): () => void {
  const timers = tasks.map((task) => {
    const timer = setInterval(() => {
      Promise.resolve()
        .then(task.run)
        .catch((err) => onError(task.name, err));
    }, task.intervalMs);
    timer.unref();
    return timer;
  });
  return () => timers.forEach(clearInterval);
}
