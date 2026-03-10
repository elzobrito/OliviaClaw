import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { TelegramInputAdapter, type TelegramMessageLike, type TelegramRuntime } from '../../src/adapters/telegram/TelegramInputAdapter';
import { TelegramOutputAdapter } from '../../src/adapters/telegram/TelegramOutputAdapter';
import { AgentController } from '../../src/controller/AgentController';
import { MessageQueue } from '../../src/controller/MessageQueue';
import { MediaPreprocessor } from '../../src/media/services/MediaPreprocessor';
import type { SpeechToTextPort } from '../../src/media/contracts/SpeechToTextPort';

function createRuntime() {
  let handler: ((message: TelegramMessageLike) => Promise<void>) | null = null;
  const runtime: TelegramRuntime = {
    onMessage(fn) {
      handler = fn;
    },
    async start() {},
    async stop() {},
    async sendTransientFeedback() {},
  };

  return {
    runtime,
    async emit(message: TelegramMessageLike) {
      if (!handler) throw new Error('runtime handler not initialized');
      await handler(message);
    },
  };
}

function buildController(mediaPreprocessor: MediaPreprocessor) {
  return new AgentController(
    { provider: 'gemini', memoryWindowSize: 20 },
    {
      messageQueue: new MessageQueue({ maxQueueSize: 20 }),
      mediaPreprocessor,
      memoryManager: {
        findOrCreateConversation: () => ({ id: 'conv-int' }),
        getHistory: () => [],
        persistMessage: () => 1,
      },
      skillLoader: { load: async () => ({ skills: [], errors: [] }), buildAvailableSkillsSummary: () => '' },
      skillRouter: { routeWithFallback: async () => ({ skillName: null }) },
      toolRegistry: { getGlobalTools: () => [], getByName: () => undefined },
      agentLoop: {
        run: async (ctx) => ({
          ...ctx,
          finalResponse: `echo:${ctx.normalizedInput.text ?? ''}`,
          outputType: 'text',
        }),
      },
    },
  );
}

describe('Telegram end-to-end flow (text/docs/audio)', () => {
  it('processes text and markdown document through adapter -> core -> output', async () => {
    const { runtime, emit } = createRuntime();
    const downloadFile = vi.fn(async (fileId: string) => {
      if (fileId === 'doc-md') {
        return {
          filePath: path.join(process.cwd(), 'tests', 'fixtures', 'sample.md'),
          mimeType: 'text/markdown',
          sizeBytes: 128,
        };
      }
      return {
        filePath: path.join(process.cwd(), 'tests', 'fixtures', 'sample.pdf'),
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      };
    });

    const adapter = new TelegramInputAdapter({
      allowedUserIds: ['42'],
      downloadTimeoutMs: 10_000,
      runtime,
      downloadFile,
    });

    const media = new MediaPreprocessor({
      maxAudioBytes: 20 * 1024 * 1024,
      maxAudioDurationSeconds: 600,
      sttTimeoutMs: 5_000,
      allowedRoots: ['./tests', './tmp'],
    });
    const controller = buildController(media);

    const sendMessage = vi.fn(async () => ({ message_id: 1 }));
    const outputAdapter = new TelegramOutputAdapter({
      sendMessage,
      sendDocument: vi.fn(async () => ({ message_id: 2 })),
      sendAudio: vi.fn(async () => ({ message_id: 3 })),
    } as any);

    await adapter.start(async (input) => {
      await controller.enqueue(input, async (output) => {
        await outputAdapter.send(output);
      });
    });

    await emit({
      message_id: 1,
      from: { id: 42 },
      chat: { id: 100 },
      text: 'ola',
    });
    await emit({
      message_id: 2,
      from: { id: 42 },
      chat: { id: 100 },
      caption: 'leia doc',
      document: { file_id: 'doc-md', mime_type: 'text/markdown', file_size: 128, file_name: 'sample.md' },
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(sendMessage).toHaveBeenCalled();
  });

  it('processes voice/audio with ingestao leve no adapter and STT in media service', async () => {
    const { runtime, emit } = createRuntime();
    const downloadFile = vi.fn(async () => ({
      filePath: path.join(process.cwd(), 'tests', 'fixtures', 'sample-audio.ogg'),
      mimeType: 'audio/ogg',
      sizeBytes: 512,
      durationSeconds: 3,
    }));

    const adapter = new TelegramInputAdapter({
      allowedUserIds: ['42'],
      downloadTimeoutMs: 10_000,
      runtime,
      downloadFile,
    });

    const stt: SpeechToTextPort = {
      transcribe: async () => ({ text: 'transcricao integracao', metadata: { provider: 'mock' } }),
    };
    const media = new MediaPreprocessor(
      {
        maxAudioBytes: 20 * 1024 * 1024,
        maxAudioDurationSeconds: 600,
        sttTimeoutMs: 5_000,
        allowedRoots: ['./tests', './tmp'],
      },
      { speechToText: stt },
    );
    const controller = buildController(media);

    const sendMessage = vi.fn(async () => ({ message_id: 1 }));
    const outputAdapter = new TelegramOutputAdapter({
      sendMessage,
      sendDocument: vi.fn(async () => ({ message_id: 2 })),
      sendAudio: vi.fn(async () => ({ message_id: 3 })),
    } as any);

    await adapter.start(async (input) => {
      await controller.enqueue(input, async (output) => {
        await outputAdapter.send(output);
      });
    });

    await emit({
      message_id: 10,
      from: { id: 42 },
      chat: { id: 100 },
      voice: { file_id: 'voice-1', mime_type: 'audio/ogg', duration: 3, file_size: 512 },
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(sendMessage).toHaveBeenCalled();
  });
});
