import { ILlmProvider, LlmProviderError } from './ILlmProvider.js';

export type ProviderName = 'gemini' | 'deepseek' | 'groq' | 'openai';

export interface ProviderFactoryConfig {
  defaultProvider: ProviderName;
  geminiApiKey?: string;
  deepseekApiKey?: string;
  groqApiKey?: string;
  openaiApiKey?: string;
}

class UnavailableProvider implements ILlmProvider {
  readonly providerId: string;

  constructor(providerId: string) {
    this.providerId = providerId;
  }

  async chat(): Promise<never> {
    throw new LlmProviderError(
      `${this.providerId} provider is not implemented in this stage.`,
      'provider_error',
      false,
    );
  }
}

function hasKey(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

export class ProviderFactory {
  private readonly config: ProviderFactoryConfig;

  constructor(config: ProviderFactoryConfig) {
    this.config = config;
  }

  getAvailableProviders(): ProviderName[] {
    const available: ProviderName[] = [];
    if (hasKey(this.config.geminiApiKey)) available.push('gemini');
    if (hasKey(this.config.deepseekApiKey)) available.push('deepseek');
    if (hasKey(this.config.groqApiKey)) available.push('groq');
    if (hasKey(this.config.openaiApiKey)) available.push('openai');
    return available;
  }

  buildFallbackChain(): ProviderName[] {
    const available = this.getAvailableProviders();
    if (available.length === 0) {
      throw new LlmProviderError('No valid provider configuration found.', 'invalid_request', false);
    }

    const ordered: ProviderName[] = [];
    const pushIfAvailable = (name: ProviderName) => {
      if (available.includes(name) && !ordered.includes(name)) {
        ordered.push(name);
      }
    };

    pushIfAvailable(this.config.defaultProvider);
    pushIfAvailable('gemini');
    pushIfAvailable('deepseek');
    pushIfAvailable('groq');
    pushIfAvailable('openai');

    return ordered;
  }

  create(name: ProviderName): ILlmProvider {
    const available = this.getAvailableProviders();
    if (!available.includes(name)) {
      throw new LlmProviderError(`Provider ${name} is not configured.`, 'invalid_request', false);
    }

    // Implementações concretas serão acopladas em tasks seguintes.
    return new UnavailableProvider(name);
  }

  createDefaultChain(): ILlmProvider[] {
    return this.buildFallbackChain().map((providerName) => this.create(providerName));
  }
}

export function createProviderFactoryFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderFactory {
  const defaultProvider = (env.DEFAULT_PROVIDER?.toLowerCase() ?? 'gemini') as ProviderName;
  if (!['gemini', 'deepseek', 'groq', 'openai'].includes(defaultProvider)) {
    throw new LlmProviderError('DEFAULT_PROVIDER is invalid.', 'invalid_request', false);
  }

  return new ProviderFactory({
    defaultProvider,
    geminiApiKey: env.GEMINI_API_KEY,
    deepseekApiKey: env.DEEPSEEK_API_KEY,
    groqApiKey: env.GROQ_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
  });
}
