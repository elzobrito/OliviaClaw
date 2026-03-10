export interface CommandArgRule {
  name: string;
  required: boolean;
  pattern: RegExp;
  description: string;
}

export interface CommandProfile {
  root: string;
  allowedCwds: string[];
  args: CommandArgRule[];
  allowFlags: string[];
}

export const FORBIDDEN_METACHAR_PATTERN = /(&&|\|\||;|>|<|`|\$\()/;

export const COMMAND_PROFILES: Record<string, CommandProfile> = {
  git_status: {
    root: 'git',
    allowedCwds: ['./', './src', './docs'],
    allowFlags: ['status', '--short', '--branch'],
    args: [],
  },
  npm_test: {
    root: 'npm',
    allowedCwds: ['./'],
    allowFlags: ['test', 'run', '--', '--coverage'],
    args: [
      {
        name: 'script',
        required: false,
        pattern: /^[a-zA-Z0-9:_-]{1,60}$/,
        description: 'Nome de script NPM permitido',
      },
    ],
  },
  node_run: {
    root: 'node',
    allowedCwds: ['./'],
    allowFlags: [],
    args: [
      {
        name: 'entry',
        required: true,
        pattern: /^[a-zA-Z0-9_./-]{1,160}$/,
        description: 'Arquivo de entrada relativo e validado por path safety',
      },
    ],
  },
};

export function hasForbiddenMetachar(input: string): boolean {
  return FORBIDDEN_METACHAR_PATTERN.test(input);
}
