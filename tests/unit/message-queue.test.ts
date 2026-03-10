import { describe, expect, it, vi } from 'vitest';
import { MessageQueue } from '../../src/controller/MessageQueue';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('MessageQueue', () => {
  it('processes tasks in FIFO order per actor and cleans up state', async () => {
    const queue = new MessageQueue({ maxQueueSize: 10 });
    const events: string[] = [];

    await queue.enqueue('telegram:1', async () => {
      await wait(20);
      events.push('A1');
    });
    await queue.enqueue('telegram:1', async () => {
      events.push('A2');
    });
    await queue.enqueue('telegram:2', async () => {
      events.push('B1');
    });

    await wait(80);

    expect(events.indexOf('A1')).toBeLessThan(events.indexOf('A2'));
    expect(events).toContain('B1');
    expect(queue.totalQueuedActors()).toBe(0);
  });

  it('returns false only when queue is full', async () => {
    const queue = new MessageQueue({ maxQueueSize: 1 });

    const accepted = await queue.enqueue('telegram:3', async () => {
      await wait(50);
    });
    const rejected = await queue.enqueue('telegram:3', async () => undefined);

    expect(accepted).toBe(true);
    expect(rejected).toBe(false);
  });

  it('isolates task failures and keeps draining queue', async () => {
    const onTaskError = vi.fn();
    const queue = new MessageQueue({ maxQueueSize: 5, onTaskError });
    const events: string[] = [];

    await queue.enqueue('telegram:9', async () => {
      throw new Error('boom');
    });
    await queue.enqueue('telegram:9', async () => {
      events.push('after-error');
    });

    await wait(50);

    expect(onTaskError).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['after-error']);
  });
});
