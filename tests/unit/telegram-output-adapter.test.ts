import { describe, expect, it, vi } from 'vitest';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { TelegramOutputAdapter } from '../../src/adapters/telegram/TelegramOutputAdapter';
import type { NormalizedOutput } from '../../src/channels/contracts/NormalizedOutput';

function baseOutput(partial: Partial<NormalizedOutput>): NormalizedOutput {
  return {
    outputType: 'text',
    text: 'ok',
    channelRef: {
      channel: 'telegram',
      ref: { chatId: 123, messageId: 1 },
    },
    ...partial,
  };
}

describe('TelegramOutputAdapter', () => {
  async function copyFixtureToTmp(filename: string): Promise<string> {
    const source = path.join(process.cwd(), 'tests', 'fixtures', filename);
    const dir = path.join(process.cwd(), 'tmp', 'test-output-adapter');
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, `${Date.now()}-${filename}`);
    await copyFile(source, target);
    return target;
  }

  it('sends long text in ordered chunks', async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 10 }));
    const api = { sendMessage, sendDocument: vi.fn(), sendAudio: vi.fn() } as any;
    const adapter = new TelegramOutputAdapter(api);

    const longText = `${'palavra '.repeat(900)}`;
    const result = await adapter.send(baseOutput({ outputType: 'text', text: longText }));

    expect(result.success).toBe(true);
    expect(sendMessage).toHaveBeenCalled();
  });

  it('sends file output when filePath exists', async () => {
    const sendDocument = vi.fn(async () => ({ message_id: 20 }));
    const api = { sendMessage: vi.fn(), sendDocument, sendAudio: vi.fn() } as any;
    const adapter = new TelegramOutputAdapter(api);
    const filePath = await copyFixtureToTmp('sample.md');

    const result = await adapter.send(
      baseOutput({ outputType: 'file', filePath }),
    );

    expect(result.success).toBe(true);
    expect(sendDocument).toHaveBeenCalled();
  });

  it('sends audio when audioPath is provided', async () => {
    const sendAudio = vi.fn(async () => ({ message_id: 30 }));
    const api = { sendMessage: vi.fn(), sendDocument: vi.fn(), sendAudio } as any;
    const adapter = new TelegramOutputAdapter(api);
    const audioPath = await copyFixtureToTmp('sample-audio.ogg');

    const result = await adapter.send(
      baseOutput({ outputType: 'audio', audioPath }),
    );

    expect(result.success).toBe(true);
    expect(sendAudio).toHaveBeenCalled();
  });

  it('degrades audio reply to text when no audioPath exists', async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 40 }));
    const api = { sendMessage, sendDocument: vi.fn(), sendAudio: vi.fn() } as any;
    const adapter = new TelegramOutputAdapter(api);

    const result = await adapter.send(
      baseOutput({
        outputType: 'text',
        text: 'fallback text',
        replyMetadata: { extra: { requiresAudioReply: true } },
      }),
    );

    expect(result.success).toBe(true);
    expect(sendMessage).toHaveBeenCalled();
  });

  it('retries once on 429 Retry-After and then succeeds', async () => {
    vi.useFakeTimers();
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 1 }, description: 'Too Many Requests' })
      .mockResolvedValueOnce({ message_id: 50 });

    const api = { sendMessage, sendDocument: vi.fn(), sendAudio: vi.fn() } as any;
    const adapter = new TelegramOutputAdapter(api);

    const promise = adapter.send(baseOutput({ outputType: 'text', text: 'retry me' }));
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.success).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not loop on user blocked errors', async () => {
    const sendMessage = vi.fn().mockRejectedValue({ error_code: 403, description: 'bot was blocked by the user' });
    const api = { sendMessage, sendDocument: vi.fn(), sendAudio: vi.fn() } as any;
    const adapter = new TelegramOutputAdapter(api);

    const result = await adapter.send(baseOutput({ outputType: 'text', text: 'x' }));

    expect(result.success).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
