export type QueueTask = () => Promise<void> | void;

interface ActorQueueState {
  running: boolean;
  items: QueueTask[];
}

export interface MessageQueueConfig {
  maxQueueSize: number;
  onTaskError?: (actorId: string, error: unknown) => void;
}

export class MessageQueue {
  private readonly maxQueueSize: number;
  private readonly onTaskError?: (actorId: string, error: unknown) => void;
  private readonly queues = new Map<string, ActorQueueState>();

  constructor(config: MessageQueueConfig) {
    this.maxQueueSize = config.maxQueueSize;
    this.onTaskError = config.onTaskError;
  }

  async enqueue(actorId: string, task: QueueTask): Promise<boolean> {
    const key = String(actorId ?? '').trim();
    if (!key) {
      throw new Error('actorId is required.');
    }

    const state = this.queues.get(key) ?? { running: false, items: [] };
    const currentDepth = state.items.length + (state.running ? 1 : 0);
    if (currentDepth >= this.maxQueueSize) {
      return false;
    }

    state.items.push(task);
    this.queues.set(key, state);

    if (!state.running) {
      state.running = true;
      void this.drain(key, state);
    }

    return true;
  }

  size(actorId: string): number {
    return this.queues.get(actorId)?.items.length ?? 0;
  }

  totalQueuedActors(): number {
    return this.queues.size;
  }

  private async drain(actorId: string, state: ActorQueueState): Promise<void> {
    while (state.items.length > 0) {
      const current = state.items.shift();
      if (!current) continue;

      try {
        await current();
      } catch (error) {
        this.onTaskError?.(actorId, error);
      }
    }

    state.running = false;
    if (state.items.length === 0) {
      this.queues.delete(actorId);
    }
  }
}
