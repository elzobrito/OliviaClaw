import {
  COMMAND_PROFILES,
  hasForbiddenMetachar,
  type CommandProfile,
} from './CommandProfiles.js';

export interface ParsedCommand {
  profileName: string;
  root: string;
  args: string[];
  cwd?: string;
}

export interface ParseError {
  code:
    | 'EMPTY_COMMAND'
    | 'SYNTAX_ERROR'
    | 'UNKNOWN_COMMAND'
    | 'FORBIDDEN_METACHAR'
    | 'INVALID_FLAG'
    | 'INVALID_ARG';
  message: string;
}

export interface ParseResult {
  ok: boolean;
  command?: ParsedCommand;
  error?: ParseError;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === undefined) {
      continue;
    }

    if ((ch === '"' || ch === "'") && !inQuote) {
      inQuote = true;
      quoteChar = ch;
      continue;
    }

    if (inQuote && ch === quoteChar) {
      inQuote = false;
      quoteChar = '';
      continue;
    }

    if (!inQuote && /\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (inQuote) {
    throw new Error('Unclosed quote');
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function validateAgainstProfile(
  profileName: string,
  profile: CommandProfile,
  tokens: string[],
): ParseResult {
  const root = tokens[0];
  if (!root) {
    return { ok: false, error: { code: 'EMPTY_COMMAND', message: 'Command is empty.' } };
  }
  const args = tokens.slice(1);

  for (const token of args) {
    if (token.startsWith('-') && !profile.allowFlags.includes(token)) {
      return {
        ok: false,
        error: { code: 'INVALID_FLAG', message: `Flag not allowed: ${token}` },
      };
    }
  }

  for (const rule of profile.args) {
    const value = args.find((token) => !token.startsWith('-'));
    if (rule.required && !value) {
      return {
        ok: false,
        error: { code: 'INVALID_ARG', message: `Required arg missing: ${rule.name}` },
      };
    }
    if (value && !rule.pattern.test(value)) {
      return {
        ok: false,
        error: { code: 'INVALID_ARG', message: `Invalid arg for ${rule.name}` },
      };
    }
  }

  return {
    ok: true,
    command: {
      profileName,
      root,
      args,
    },
  };
}

export function parseCommand(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: { code: 'EMPTY_COMMAND', message: 'Command is empty.' } };
  }

  if (hasForbiddenMetachar(trimmed)) {
    return {
      ok: false,
      error: { code: 'FORBIDDEN_METACHAR', message: 'Forbidden metacharacter found.' },
    };
  }

  let tokens: string[];
  try {
    tokens = tokenize(trimmed);
  } catch {
    return { ok: false, error: { code: 'SYNTAX_ERROR', message: 'Invalid quote syntax.' } };
  }

  if (tokens.length === 0) {
    return { ok: false, error: { code: 'EMPTY_COMMAND', message: 'Command is empty.' } };
  }

  const root = tokens[0];
  if (!root) {
    return { ok: false, error: { code: 'EMPTY_COMMAND', message: 'Command is empty.' } };
  }
  const profileEntry = Object.entries(COMMAND_PROFILES).find(([, profile]) => profile.root === root);
  if (!profileEntry) {
    return {
      ok: false,
      error: { code: 'UNKNOWN_COMMAND', message: `Unknown command root: ${root}` },
    };
  }

  const [profileName, profile] = profileEntry;
  return validateAgainstProfile(profileName, profile, tokens);
}
