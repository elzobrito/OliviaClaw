import { logger } from './logger.js';

export type ShutdownSignal = 'SIGINT' | 'SIGTERM' | 'MANUAL';

export interface ShutdownContext {
  signal: ShutdownSignal;
  reason?: string;
}

export type ShutdownTask = (context: ShutdownContext) => Promise<void>;

export interface ShutdownController {
  register(name: string, task: ShutdownTask): void;
  run(signal: ShutdownSignal, reason?: string): Promise<void>;
  installSignalHandlers(): void;
  isShuttingDown(): boolean;
}

class ProcessShutdownController implements ShutdownController {
  private readonly tasks: Array<{ name: string; task: ShutdownTask }> = [];
  private runningPromise: Promise<void> | null = null;
  private shuttingDown = false;
  private handlersInstalled = false;

  register(name: string, task: ShutdownTask): void {
    this.tasks.push({ name, task });
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  installSignalHandlers(): void {
    if (this.handlersInstalled) return;
    this.handlersInstalled = true;

    const onSignal = (signal: ShutdownSignal) => {
      void this.run(signal).catch((error) => {
        logger.error({ error, signal }, 'Shutdown failed unexpectedly');
      });
    };

    process.once('SIGINT', () => onSignal('SIGINT'));
    process.once('SIGTERM', () => onSignal('SIGTERM'));
  }

  async run(signal: ShutdownSignal, reason?: string): Promise<void> {
    if (this.runningPromise) {
      logger.warn({ signal, reason }, 'Shutdown already in progress; ignoring duplicate request');
      return this.runningPromise;
    }

    this.shuttingDown = true;

    this.runningPromise = (async () => {
      const context: ShutdownContext = { signal, reason };
      logger.info({ signal, reason, tasks: this.tasks.length }, 'Starting graceful shutdown');

      // Close resources in reverse registration order to mirror startup dependencies.
      for (const entry of [...this.tasks].reverse()) {
        try {
          await entry.task(context);
          logger.info({ signal, task: entry.name }, 'Shutdown task completed');
        } catch (error) {
          logger.error({ signal, task: entry.name, error }, 'Shutdown task failed');
        }
      }

      logger.info({ signal }, 'Graceful shutdown completed');
    })();

    return this.runningPromise;
  }
}

export const shutdownController: ShutdownController = new ProcessShutdownController();
