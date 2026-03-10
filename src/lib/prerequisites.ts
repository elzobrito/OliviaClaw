import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type PrerequisiteName = 'whisper' | 'ffmpeg' | 'edge-tts';

export interface PrerequisiteCheckResult {
  name: PrerequisiteName;
  configuredCommand: string;
  executable: string;
  available: boolean;
  disableCapabilities: string[];
  warning?: string;
}

export interface PrerequisitesReport {
  checks: PrerequisiteCheckResult[];
  degradedCapabilities: string[];
  warnings: string[];
}

export interface PrerequisitesInput {
  whisperCommand?: string | null;
  ffmpegCommand?: string | null;
  edgeTtsCommand?: string | null;
}

export interface SanitizedPrerequisiteError {
  code: 'PREREQUISITE_CHECK_FAILED';
  message: string;
}

function firstToken(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return command;
  const quoted = trimmed.match(/^"([^"]+)"(?:\s+.*)?$/);
  if (quoted?.[1]) {
    return quoted[1];
  }
  return trimmed.split(/\s+/)[0] ?? command;
}

function commandLookupProgram(): string {
  return process.platform === 'win32' ? 'where' : 'which';
}

function checkBinaryAvailability(executable: string): boolean {
  const hasPathHint = executable.includes('/') || executable.includes('\\') || path.isAbsolute(executable);
  if (hasPathHint && existsSync(executable)) {
    return true;
  }

  const lookup = commandLookupProgram();
  const result = spawnSync(lookup, [executable], {
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: false,
  });

  return result.status === 0;
}

function buildResult(
  name: PrerequisiteName,
  configuredCommand: string,
  disableCapabilities: string[],
): PrerequisiteCheckResult {
  const executable = firstToken(configuredCommand);
  const available = checkBinaryAvailability(executable);

  if (available) {
    return {
      name,
      configuredCommand,
      executable,
      available: true,
      disableCapabilities: [],
    };
  }

  return {
    name,
    configuredCommand,
    executable,
    available: false,
    disableCapabilities,
    warning: `${name} is unavailable on host. Related capabilities will be disabled.`,
  };
}

export function checkPrerequisites(input: PrerequisitesInput = {}): PrerequisitesReport {
  const whisperCommand = input.whisperCommand?.trim() || 'whisper';
  const ffmpegCommand = input.ffmpegCommand?.trim() || 'ffmpeg';
  const edgeTtsCommand = input.edgeTtsCommand?.trim() || 'edge-tts';

  const checks: PrerequisiteCheckResult[] = [
    buildResult('whisper', whisperCommand, ['stt']),
    buildResult('ffmpeg', ffmpegCommand, ['audio_transcoding']),
    buildResult('edge-tts', edgeTtsCommand, ['tts']),
  ];

  const degradedCapabilities = Array.from(
    new Set(checks.flatMap((check) => check.disableCapabilities)),
  );

  const warnings = checks
    .filter((check) => !check.available && check.warning)
    .map((check) => check.warning as string);

  return {
    checks,
    degradedCapabilities,
    warnings,
  };
}

export function toSanitizedPrerequisiteError(_: unknown): SanitizedPrerequisiteError {
  return {
    code: 'PREREQUISITE_CHECK_FAILED',
    message: 'Unable to verify host prerequisites.',
  };
}
