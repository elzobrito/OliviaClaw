import path from 'node:path';

export interface PathSafetyError {
  code: 'PATH_VALIDATION_ERROR' | 'PATH_TRAVERSAL_BLOCKED' | 'PATH_OUTSIDE_ALLOWED_ROOTS';
  message: string;
  inputPath?: string;
}

function normalizeForComparison(value: string): string {
  let normalized = path.normalize(value);

  if (normalized.length > 1 && /[\\/]$/.test(normalized)) {
    normalized = normalized.replace(/[\\/]+$/, '');
  }

  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

function hasTraversalSegments(inputPath: string): boolean {
  const unified = inputPath.replace(/\\/g, '/');
  return unified.split('/').some((segment) => segment === '..');
}

export function resolveAbsolutePath(inputPath: string, baseDir: string = process.cwd()): string {
  return path.resolve(baseDir, inputPath);
}

export function resolveAllowedRoots(roots: string[], baseDir: string = process.cwd()): string[] {
  return roots.map((root) => normalizeForComparison(path.resolve(baseDir, root)));
}

export function isPathInsideRoot(candidateAbsolutePath: string, rootAbsolutePath: string): boolean {
  const candidate = normalizeForComparison(candidateAbsolutePath);
  const root = normalizeForComparison(rootAbsolutePath);

  if (candidate === root) return true;

  const relative = path.relative(root, candidate);
  if (!relative) return true;

  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function assertPathWithinAllowedRoots(
  inputPath: string,
  allowedRoots: string[],
  baseDir: string = process.cwd(),
): string {
  if (!inputPath || inputPath.trim().length === 0) {
    throw createPathSafetyError('PATH_VALIDATION_ERROR', 'Path is required.', inputPath);
  }

  const resolvedInput = resolveAbsolutePath(inputPath, baseDir);
  const normalizedInput = normalizeForComparison(resolvedInput);
  const normalizedRoots = resolveAllowedRoots(allowedRoots, baseDir);

  if (normalizedRoots.length === 0) {
    throw createPathSafetyError(
      'PATH_VALIDATION_ERROR',
      'No allowed tool roots configured.',
      inputPath,
    );
  }

  const inside = normalizedRoots.some((root) => isPathInsideRoot(normalizedInput, root));
  if (!inside) {
    const isTraversalAttempt = hasTraversalSegments(inputPath);
    throw createPathSafetyError(
      isTraversalAttempt ? 'PATH_TRAVERSAL_BLOCKED' : 'PATH_OUTSIDE_ALLOWED_ROOTS',
      isTraversalAttempt ? 'Path traversal attempt blocked.' : 'Path is outside allowed roots.',
      inputPath,
    );
  }

  return resolvedInput;
}

export function createPathSafetyError(
  code: PathSafetyError['code'],
  message: string,
  inputPath?: string,
): PathSafetyError {
  return {
    code,
    message,
    inputPath,
  };
}
