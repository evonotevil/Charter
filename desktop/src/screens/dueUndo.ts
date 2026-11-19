export const dueUndoDuration = 5000;
export const dueCompletionDelay = 160;

/** 允许不同事项同时完成，拒绝同一事项的重复点击，并标出最近一次操作。 */
export class DueCompletionQueue {
  private sequence = 0;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  begin() { return ++this.sequence; }

  schedule(key: string, complete: (sequence: number) => void): number | null {
    if (this.timers.has(key)) return null;
    const sequence = this.begin();
    const timer = setTimeout(() => {
      this.timers.delete(key);
      complete(sequence);
    }, dueCompletionDelay);
    this.timers.set(key, timer);
    return sequence;
  }

  cancel(key: string) {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  isLatest(sequence: number) { return sequence === this.sequence; }

  dispose() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

/** 申报日历撤销的独立倒计时。悬停或键盘焦点期间保留剩余时间。 */
export class DueUndoTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private remaining = dueUndoDuration;
  private started = 0;
  private expire: (() => void) | null = null;
  private holds = new Set<string>();

  start(expire: () => void) {
    this.cancel();
    this.remaining = dueUndoDuration;
    this.expire = expire;
    this.schedule();
  }

  pause(reason = "default") {
    this.holds.add(reason);
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.remaining = Math.max(0, this.remaining - (Date.now() - this.started));
  }

  resume(reason = "default") {
    this.holds.delete(reason);
    if (this.expire && !this.timer && !this.holds.size) this.schedule();
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.expire = null;
    this.holds.clear();
  }

  private schedule() {
    const expire = this.expire;
    if (!expire) return;
    this.started = Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.expire = null;
      expire();
    }, this.remaining);
  }
}
