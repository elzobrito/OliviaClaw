import path from 'node:path';
import { assertPathWithinAllowedRoots } from '../../lib/pathSafety.js';
import {
  COMMAND_PROFILES,
  hasForbiddenMetachar,
  type CommandProfile,
} from './CommandProfiles.js';
import type { ParsedCommand } from './CommandArgumentParser.js';

export interface CommandExecutionPlan {
  command: string;
  args: string[];
  cwd: string;
  shell: false;
}

export interface CommandValidationResult {
  ok: boolean;
  plan?: CommandExecutionPlan;
  error?: {
    code:
      | 'COMMAND_PROFILE_NOT_FOUND'
      | 'COMMAND_FORBIDDEN_METACHAR'
      | 'COMMAND_INVALID_ARG_COUNT'
      | 'COMMAND_INVALID_ARG'
      | 'COMMAND_INVALID_CWD';
    message: string;
  };
}

function validateArgRules(profile: CommandProfile, args: string[]): CommandValidationResult {
  const positional = args.filter((arg) => !arg.startsWith('-'));

  const requiredCount = profile.args.filter((rule) => rule.required).length;
  if (positional.length < requiredCount) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_INVALID_ARG_COUNT',
        message: 'Required argument count not satisfied.',
      },
    };
  }
  if (positional.length > profile.args.length) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_INVALID_ARG_COUNT',
        message: 'Too many positional arguments for command profile.',
      },
    };
  }

  for (let i = 0; i < profile.args.length; i += 1) {
    const rule = profile.args[i];
    const value = positional[i];
    if (!rule || !value) continue;

    if (!rule.pattern.test(value)) {
      return {
        ok: false,
        error: {
          code: 'COMMAND_INVALID_ARG',
          message: `Argument failed validation: ${rule.name}`,
        },
      };
    }
  }

  return { ok: true };
}

export function validateCommandPolicy(
  parsed: ParsedCommand,
  requestedCwd: string,
  baseDir: string = process.cwd(),
): CommandValidationResult {
  const profile = COMMAND_PROFILES[parsed.profileName];
  if (!profile) {
    return {
      ok: false,
      error: { code: 'COMMAND_PROFILE_NOT_FOUND', message: 'Command profile not found.' },
    };
  }

  if (hasForbiddenMetachar(parsed.root) || parsed.args.some((arg) => hasForbiddenMetachar(arg))) {
    return {
      ok: false,
      error: { code: 'COMMAND_FORBIDDEN_METACHAR', message: 'Forbidden metacharacter found.' },
    };
  }

  const argValidation = validateArgRules(profile, parsed.args);
  if (!argValidation.ok) {
    return argValidation;
  }

  try {
    const allowedRoots = profile.allowedCwds.map((cwd) => path.resolve(baseDir, cwd));
    const safeCwd = assertPathWithinAllowedRoots(requestedCwd, allowedRoots, baseDir);

    return {
      ok: true,
      plan: {
        command: parsed.root,
        args: parsed.args,
        cwd: safeCwd,
        shell: false,
      },
    };
  } catch {
    return {
      ok: false,
      error: {
        code: 'COMMAND_INVALID_CWD',
        message: 'Requested cwd is outside command policy roots.',
      },
    };
  }
}
