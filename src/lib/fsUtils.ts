import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { assertPathWithinAllowedRoots } from './pathSafety.js';
import { AppError } from './errors.js';

export interface FileMetadata {
    sizeBytes: number;
    createdAt: Date;
    modifiedAt: Date;
    isDirectory: boolean;
    isFile: boolean;
}

/**
 * Encapsula erros do sistema de arquivos em instâncias de AppError sanitizadas.
 */
function handleFsError(error: unknown, action: string): never {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('ENOENT')) {
        throw new AppError(`File or directory not found during ${action}.`, 'FS_NOT_FOUND', undefined, true);
    }
    if (msg.includes('EACCES') || msg.includes('EPERM')) {
        throw new AppError(`Permission denied during ${action}.`, 'FS_PERMISSION_DENIED', undefined, true);
    }
    // Se for erro do pathSafety, repassa
    if (typeof error === 'object' && error !== null && 'code' in error && String((error as any).code).startsWith('PATH_')) {
        throw new AppError(`Path safety violation: ${(error as any).message}`, 'FS_SECURITY_VIOLATION', undefined, true);
    }
    throw new AppError(`Unexpected file system error during ${action}.`, 'FS_UNKNOWN_ERROR', undefined, false);
}

/**
 * Cria um diretório e todos os seus pais, validando pelas roots permitidas.
 */
export async function createDirSafe(targetPath: string, allowedRoots: string[]): Promise<string> {
    try {
        const safePath = assertPathWithinAllowedRoots(targetPath, allowedRoots);
        await fs.mkdir(safePath, { recursive: true });
        return safePath;
    } catch (err) {
        handleFsError(err, 'directory creation');
    }
}

/**
 * Escreve dados em um arquivo de texto de forma segura, criando parent dirs se necessário.
 */
export async function writeFileSafe(targetPath: string, content: string | Buffer, allowedRoots: string[]): Promise<string> {
    try {
        const safePath = assertPathWithinAllowedRoots(targetPath, allowedRoots);
        const parentDir = path.dirname(safePath);
        await fs.mkdir(parentDir, { recursive: true });
        await fs.writeFile(safePath, content);
        return safePath;
    } catch (err) {
        handleFsError(err, 'file writing');
    }
}

/**
 * Lê o conteúdo de um arquivo caso não exceda o limite de tamanho.
 */
export async function readFileSafe(targetPath: string, allowedRoots: string[], maxSizeMB?: number): Promise<Buffer> {
    try {
        const safePath = assertPathWithinAllowedRoots(targetPath, allowedRoots);
        const stat = await fs.stat(safePath);

        if (!stat.isFile()) {
            throw new AppError(`Target is not a file.`, 'FS_NOT_FILE', undefined, true);
        }

        if (maxSizeMB !== undefined) {
            const maxBytes = maxSizeMB * 1024 * 1024;
            if (stat.size > maxBytes) {
                throw new AppError(`File exceeds maximum allowed size of ${maxSizeMB}MB.`, 'FS_SIZE_LIMIT', undefined, true);
            }
        }

        return await fs.readFile(safePath);
    } catch (err: unknown) {
        if (err instanceof AppError) throw err; // repassa nossos PRÓPRIOS erros previstos no bloco interno
        handleFsError(err, 'file reading');
    }
}

/**
 * Lê metadados com segurança.
 */
export async function getMetadataSafe(targetPath: string, allowedRoots: string[]): Promise<FileMetadata> {
    try {
        const safePath = assertPathWithinAllowedRoots(targetPath, allowedRoots);
        const stat = await fs.stat(safePath);
        return {
            sizeBytes: stat.size,
            createdAt: stat.birthtime,
            modifiedAt: stat.mtime,
            isDirectory: stat.isDirectory(),
            isFile: stat.isFile(),
        };
    } catch (err) {
        handleFsError(err, 'metadata access');
    }
}

/**
 * Remove um arquivo ou diretório de forma segura.
 */
export async function removeSafe(targetPath: string, allowedRoots: string[], recursive = false): Promise<void> {
    try {
        const safePath = assertPathWithinAllowedRoots(targetPath, allowedRoots);
        await fs.rm(safePath, { recursive, force: true });
    } catch (err) {
        handleFsError(err, 'file removal');
    }
}
