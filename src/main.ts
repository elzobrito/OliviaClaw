import 'dotenv/config';
import { Bot } from 'grammy';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { loadEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { checkPrerequisites } from './lib/prerequisites.js';
import { shutdownController } from './lib/shutdown.js';
import { DatabaseSingleton } from './db/DatabaseSingleton.js';
import { ConversationRepository } from './db/repositories/ConversationRepository.js';
import { MessageRepository } from './db/repositories/MessageRepository.js';
import { MemoryManager } from './memory/MemoryManager.js';
import { ToolRegistry } from './tools/ToolRegistry.js';
import { CriarArquivoTool } from './tools/implementations/CriarArquivoTool.js';
import { LerArquivoTool } from './tools/implementations/LerArquivoTool.js';
import { ListarDiretorioTool } from './tools/implementations/ListarDiretorioTool.js';
import { ExecutarComandoTool } from './tools/implementations/ExecutarComandoTool.js';
import { GithubPushTool } from './tools/implementations/GithubPushTool.js';
import { AnalisarCodigoTool } from './tools/implementations/AnalisarCodigoTool.js';
import { BuscarWebTool } from './tools/implementations/BuscarWebTool.js';
import { SkillLoader } from './skills/SkillLoader.js';
import { SkillRouter } from './skills/SkillRouter.js';
import { MediaPreprocessor } from './media/services/MediaPreprocessor.js';
import { WhisperSpeechToTextService } from './media/services/WhisperSpeechToTextService.js';
import { AgentLoop } from './agent/AgentLoop.js';
import { OutputSafetyValidator } from './agent/OutputSafetyValidator.js';
import { MessageQueue } from './controller/MessageQueue.js';
import { AgentController } from './controller/AgentController.js';
import { TelegramInputAdapter, type TelegramRuntime } from './adapters/telegram/TelegramInputAdapter.js';
import { TelegramOutputAdapter } from './adapters/telegram/TelegramOutputAdapter.js';
import { createTempFilePath } from './lib/tempFiles.js';
import { purgeOldTempFiles } from './lib/tempFiles.js';
import { GeminiProvider } from './llm/providers/GeminiProvider.js';
import { DeepSeekProvider } from './llm/providers/DeepSeekProvider.js';
import { GroqProvider } from './llm/providers/GroqProvider.js';
import { OpenAIProvider } from './llm/providers/OpenAIProvider.js';
import type { ILlmProvider, LlmToolCall } from './llm/ILlmProvider.js';
import type { PipelineContext } from './controller/PipelineContext.js';

function requireApiKey(value: string | undefined, name: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`Missing required API key: ${name}`);
  }
  return normalized;
}

function createProvider(env: ReturnType<typeof loadEnv>): ILlmProvider {
  if (env.providers.defaultProvider === 'gemini') {
    return new GeminiProvider({
      apiKey: requireApiKey(env.providers.apiKeys.gemini, 'GEMINI_API_KEY'),
      model: 'gemini-2.0-flash',
    });
  }
  if (env.providers.defaultProvider === 'deepseek') {
    return new DeepSeekProvider({
      apiKey: requireApiKey(env.providers.apiKeys.deepseek, 'DEEPSEEK_API_KEY'),
      model: 'deepseek-chat',
    });
  }
  if (env.providers.defaultProvider === 'openai') {
    const openaiModel = (process.env.OPENAI_MODEL ?? '').trim() || 'gpt-4o';
    return new OpenAIProvider({
      apiKey: requireApiKey(env.providers.apiKeys.openai, 'OPENAI_API_KEY'),
      model: openaiModel,
    });
  }
  return new GroqProvider({
    apiKey: requireApiKey(env.providers.apiKeys.groq, 'GROQ_API_KEY'),
    model: 'llama-3.1-70b-versatile',
  });
}

async function start(): Promise<void> {
  const env = loadEnv(process.env);
  const prerequisites = checkPrerequisites({
    whisperCommand: env.media.whisperCommand,
    edgeTtsCommand: env.media.edgeTtsCommand,
  });

  if (prerequisites.warnings.length > 0) {
    logger.warn({ warnings: prerequisites.warnings }, 'Host prerequisites partially unavailable; degraded mode enabled');
  }

  const db = DatabaseSingleton.init({
    dbPath: env.paths.dbPath,
    allowedToolRoots: env.paths.allowedToolRoots,
  });

  const memoryManager = new MemoryManager(
    new ConversationRepository(db),
    new MessageRepository(),
    undefined,
    env.runtime.memoryWindowSize,
  );

  const toolRegistry = new ToolRegistry();
  [
    new CriarArquivoTool(),
    new LerArquivoTool(),
    new ListarDiretorioTool(),
    new ExecutarComandoTool(),
    new GithubPushTool(),
    new AnalisarCodigoTool(),
    new BuscarWebTool(),
  ].forEach((tool) => {
    toolRegistry.register({ tool });
  });

  const bot = new Bot(env.telegram.botToken);

  const telegramRuntime: TelegramRuntime = {
    onMessage(handler) {
      bot.on('message', async (ctx) => {
        const message = ctx.message;
        await handler({
          message_id: message.message_id,
          from: message.from ? { id: message.from.id } : undefined,
          chat: { id: message.chat.id, type: message.chat.type },
          date: message.date,
          text: message.text,
          caption: message.caption,
          document: message.document
            ? {
                file_id: message.document.file_id,
                file_name: message.document.file_name,
                mime_type: message.document.mime_type,
                file_size: message.document.file_size,
              }
            : undefined,
          audio: message.audio
            ? {
                file_id: message.audio.file_id,
                mime_type: message.audio.mime_type,
                duration: message.audio.duration,
                file_size: message.audio.file_size,
              }
            : undefined,
          voice: message.voice
            ? {
                file_id: message.voice.file_id,
                mime_type: message.voice.mime_type,
                duration: message.voice.duration,
                file_size: message.voice.file_size,
              }
            : undefined,
        });
      });
    },
    async start() {
      await bot.start();
    },
    async stop() {
      await bot.stop();
    },
    async sendTransientFeedback(chatId, action) {
      const mapped = action === 'record_voice' ? 'record_voice' : 'typing';
      await bot.api.sendChatAction(Number(chatId), mapped as any);
    },
  };

  const inputAdapter = new TelegramInputAdapter({
    allowedUserIds: env.telegram.allowedUserIds,
    privateOnly: env.telegram.privateOnly,
    downloadTimeoutMs: env.media.inputDownloadTimeoutMs,
    maxAudioBytes: env.media.maxAudioMb * 1024 * 1024,
    maxAudioDurationSeconds: env.media.maxAudioDurationSeconds,
    runtime: telegramRuntime,
    downloadFile: async (fileId, timeoutMs) => {
      const file = await bot.api.getFile(fileId);
      const ext = path.extname(file.file_path ?? '') || '.bin';
      const outputPath = await createTempFilePath(env.paths.tmpDir, env.paths.allowedToolRoots, {
        prefix: 'input',
        extension: ext,
      });
      const fileUrl = `https://api.telegram.org/file/bot${env.telegram.botToken}/${file.file_path}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(fileUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error('Telegram file download failed.');
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        await writeFile(outputPath, bytes);
        return {
          filePath: outputPath,
          mimeType: 'application/octet-stream',
          sizeBytes: bytes.length,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  });

  const outputAdapter = new TelegramOutputAdapter(bot.api as any);
  const sttService = env.media.whisperCommand
    ? new WhisperSpeechToTextService({
        command: env.media.whisperCommand,
        maxAudioBytes: env.media.maxAudioMb * 1024 * 1024,
        maxAudioDurationSeconds: env.media.maxAudioDurationSeconds,
      })
    : undefined;

  const mediaPreprocessor = new MediaPreprocessor(
    {
      maxAudioBytes: env.media.maxAudioMb * 1024 * 1024,
      maxAudioDurationSeconds: env.media.maxAudioDurationSeconds,
      sttTimeoutMs: env.media.whisperTimeoutMs,
      allowedRoots: env.paths.allowedToolRoots,
    },
    { speechToText: sttService },
  );

  const skillLoader = new SkillLoader({ skillsDir: env.paths.skillsDir, allowedToolNames: toolRegistry.getAll().map((t) => t.definition.name) });
  const skillRouter = new SkillRouter();
  const provider = createProvider(env);

  const loop = new AgentLoop(
    {
      maxIterations: env.runtime.maxIterations,
      providerTimeoutMs: env.providers.timeoutMs,
      maxToolRepairAttemptsPerIteration: 2,
    },
    {
      provider,
      outputSafetyValidator: new OutputSafetyValidator(),
      executeToolCall: async (call: LlmToolCall, context: PipelineContext) => {
        const tool = toolRegistry.getByName(call.name);
        if (!tool) {
          return { observation: `Tool not found: ${call.name}` };
        }
        const result = await tool.execute(call.arguments);
        return {
          observation: result.output,
          filePath: result.filePath,
        };
      },
      logger,
    },
  );

  const controller = new AgentController(
    {
      provider: provider.providerId,
      memoryWindowSize: env.runtime.memoryWindowSize,
    },
    {
      messageQueue: new MessageQueue({ maxQueueSize: env.runtime.maxQueueSize }),
      mediaPreprocessor,
      memoryManager,
      skillLoader,
      skillRouter,
      toolRegistry,
      agentLoop: loop,
    },
  );

  const cleanupIntervalMs = Math.max(60_000, Number.parseInt(process.env.TMP_CLEANUP_INTERVAL_MS ?? '900000', 10) || 900_000);
  const cleanupMaxAgeMs = Math.max(60_000, Number.parseInt(process.env.TMP_CLEANUP_MAX_AGE_MS ?? '86400000', 10) || 86_400_000);
  const cleanupTimer = setInterval(async () => {
    try {
      const purged = await purgeOldTempFiles(
        env.paths.tmpDir,
        env.paths.allowedToolRoots,
        cleanupMaxAgeMs,
      );
      logger.info({ purged }, 'Temporary cleanup cycle completed');
    } catch {
      logger.warn({}, 'Temporary cleanup cycle failed');
    }
  }, cleanupIntervalMs);
  cleanupTimer.unref();

  await inputAdapter.start(async (input) => {
    const accepted = await controller.enqueue(input, async (output) => {
      const sent = await outputAdapter.send(output);
      if (!sent.success) {
        logger.warn({ actorId: input.actorId, error: sent.errorMessage }, 'Failed to deliver output');
      }
    });
    if (!accepted) {
      logger.warn({ actorId: input.actorId }, 'Message dropped because queue is full');
    }
  });

  shutdownController.register('telegram-input', async () => {
    await inputAdapter.stop();
  });
  shutdownController.register('database', async () => {
    db.close();
  });
  shutdownController.register('tmp-cleanup', async () => {
    clearInterval(cleanupTimer);
  });
  shutdownController.installSignalHandlers();

  logger.info({ provider: provider.providerId }, 'OliviaClaw application started');
}

start().catch((error) => {
  const serialized =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error && typeof error === 'object'
        ? (error as Record<string, unknown>)
        : { message: String(error) };
  logger.error({ error: serialized }, 'Fatal startup error');
  process.exitCode = 1;
});
