/**
 * Caps how many LLM calls run at once in this process. Free and low tiers limit tokens per
 * minute; parallel API requests would otherwise burn the budget together and all hit 429.
 */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly limit: number) {
    if (limit < 1) throw new Error('Semaphore limit must be at least 1');
  }

  get inFlight(): number {
    return this.active;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) {
      this.active++;
    } else {
      // The releasing task hands its slot over, so `active` stays the same
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
