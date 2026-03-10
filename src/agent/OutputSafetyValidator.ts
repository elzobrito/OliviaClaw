import { sanitizeMessageForSafeOutput } from '../lib/errors.js';

export interface OutputSafetyDecision {
  allowed: boolean;
  sanitizedText: string;
  blockedReasons: string[];
}

export interface OutputSafetyValidatorConfig {
  blockedPatterns?: RegExp[];
  redactPatterns?: RegExp[];
}

const DEFAULT_BLOCK_PATTERNS: RegExp[] = [
  /system\s+prompt/i,
  /base\s+prompt/i,
  /ag(e)?nts\.md/i,
  /you are codex/i,
  /BEGIN\s+SYSTEM\s+PROMPT/i,
  /OPENAI_API_KEY/i,
  /(?:^|[\s=:])(sk-[a-zA-Z0-9_-]{12,})/i,
];

const DEFAULT_REDACT_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s]+/gi,
];

export class OutputSafetyValidator {
  private readonly blockedPatterns: RegExp[];
  private readonly redactPatterns: RegExp[];

  constructor(config: OutputSafetyValidatorConfig = {}) {
    this.blockedPatterns = config.blockedPatterns ?? DEFAULT_BLOCK_PATTERNS;
    this.redactPatterns = config.redactPatterns ?? DEFAULT_REDACT_PATTERNS;
  }

  validate(text: string): OutputSafetyDecision {
    const input = String(text ?? '');
    const blockedReasons: string[] = [];

    for (const pattern of this.blockedPatterns) {
      if (pattern.test(input)) {
        blockedReasons.push(`blocked_by_pattern:${pattern.source}`);
      }
    }

    let sanitizedText = sanitizeMessageForSafeOutput(input);
    for (const pattern of this.redactPatterns) {
      sanitizedText = sanitizedText.replace(pattern, '[REDACTED]');
    }

    return {
      allowed: blockedReasons.length === 0,
      sanitizedText,
      blockedReasons,
    };
  }
}
