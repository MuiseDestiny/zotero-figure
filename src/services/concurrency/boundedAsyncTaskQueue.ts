export interface AsyncTaskHandle {
  cancel(): boolean;
  readonly promise: Promise<void>;
  readonly started: boolean;
}

interface QueuedAsyncTask {
  cancelled: boolean;
  reject(error: unknown): void;
  resolve(): void;
  run(): Promise<void>;
  started: boolean;
}

/** Runs asynchronous tasks with bounded concurrency and cancellable queued work. */
export class BoundedAsyncTaskQueue {
  private activeTasks = 0;
  private readonly queuedTasks: QueuedAsyncTask[] = [];

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("Task queue concurrency must be a positive integer");
    }
  }

  public get activeCount(): number {
    return this.activeTasks;
  }

  public get pendingCount(): number {
    return this.queuedTasks.length;
  }

  public enqueue(run: () => void | Promise<void>): AsyncTaskHandle {
    let task!: QueuedAsyncTask;
    const promise = new Promise<void>((resolve, reject) => {
      task = {
        cancelled: false,
        reject,
        resolve,
        run: async () => run(),
        started: false,
      };
    });
    this.queuedTasks.push(task);
    this.dispatch();
    return {
      cancel: () => this.cancel(task),
      promise,
      get started() {
        return task.started;
      },
    };
  }

  public cancelPending(): number {
    let cancelled = 0;
    for (const task of [...this.queuedTasks]) {
      if (this.cancel(task)) cancelled++;
    }
    return cancelled;
  }

  private cancel(task: QueuedAsyncTask): boolean {
    if (task.started || task.cancelled) return false;
    const index = this.queuedTasks.indexOf(task);
    if (index < 0) return false;
    this.queuedTasks.splice(index, 1);
    task.cancelled = true;
    task.resolve();
    return true;
  }

  private dispatch(): void {
    while (this.activeTasks < this.concurrency && this.queuedTasks.length > 0) {
      const task = this.queuedTasks.shift() as QueuedAsyncTask;
      if (task.cancelled) continue;
      task.started = true;
      this.activeTasks++;
      void task
        .run()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.activeTasks--;
          this.dispatch();
        });
    }
  }
}
