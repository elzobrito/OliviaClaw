import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { assertPathWithinAllowedRoots } from './pathSafety.js';
import { removeSafe, getMetadataSafe, createDirSafe } from './fsUtils.js';

export interface TempFileOptions {
    prefix?: 'input' | 'output' | string;
    extension?: string;
    baseId?: string;
}

/**
 * Cria um nome de arquivo temporário previsível com prevenção simples de colisão.
 * Formato padrão: {prefix}_{id}_{ts}.{ext}
 */
export function generateTempFilename(options?: TempFileOptions): string {
    const prefix = options?.prefix ?? 'temp';
    const ext = options?.extension ? (options.extension.startsWith('.') ? options.extension : `.${options.extension}`) : '.tmp';
    const id = options?.baseId ? options.baseId.replace(/[^a-zA-Z0-9_-]/g, '') : crypto.randomBytes(4).toString('hex');
    const ts = Date.now();
    // random suffix previne colisão caso chamadas muito rápidas tenham mesmo id e ms
    const rand = crypto.randomBytes(2).toString('hex');

    return `${prefix}_${id}_${ts}_${rand}${ext}`;
}

/**
 * Retorna o caminho absoluto para o novo arquivo temporário, 
 * assegurando que o diretório tmp exista e seja seguro pela pathSafety.
 */
export async function createTempFilePath(tmpDir: string, allowedRoots: string[], options?: TempFileOptions): Promise<string> {
    const safeTmpDir = await createDirSafe(tmpDir, allowedRoots);
    // se o retorno do createDirSafe falhar, o fsUtils.ts já lançará um AppError protegido.
    if (!safeTmpDir) {
        throw new Error('Failed to resolve safe temporary directory.');
    }
    const filename = generateTempFilename(options);
    const fullPath = path.join(safeTmpDir, filename);

    // Validação redundante (já garantida pelo safeTmpDir, mas reforça boundary check do file final)
    return assertPathWithinAllowedRoots(fullPath, allowedRoots);
}

/**
 * Limpeza idempotente de um único arquivo temporário.
 */
export async function cleanupTempFile(targetPath: string, allowedRoots: string[]): Promise<void> {
    if (!targetPath) return;
    try {
        await removeSafe(targetPath, allowedRoots, false);
    } catch (err) {
        // Falha silenciosa ou log? Temp files cleanup não devem quebrar pipelines.
        // O erro protegido FS_NOT_FOUND já é ignorado essencialmente, 
        // mas capturamos tudo para que o processo crítico prossiga.
    }
}

/**
 * Limpa arquivos do diretório que excedem uma idade máxima (em milissegundos).
 * Ideal para rodar em um processo background ou no boot do framework.
 */
export async function purgeOldTempFiles(tmpDir: string, allowedRoots: string[], maxAgeMs: number): Promise<number> {
    let purgedCount = 0;
    try {
        const safeTmpDir = assertPathWithinAllowedRoots(tmpDir, allowedRoots);
        const fs = await import('node:fs/promises');
        const files = await fs.readdir(safeTmpDir);
        const now = Date.now();

        for (const file of files) {
            if (file === '.gitkeep') continue;

            const fullPath = path.join(safeTmpDir, file);
            try {
                const meta = await getMetadataSafe(fullPath, allowedRoots);

                // Verifica se modifiedAt está mais no passado que o limite
                const ageMs = now - meta.modifiedAt.getTime();

                if (ageMs > maxAgeMs) {
                    await removeSafe(fullPath, allowedRoots, false);
                    purgedCount++;
                }
            } catch (innerErr) {
                // Ignores locked files or deleted by other process
            }
        }
    } catch (err) {
        // Pode falhar se a pasta não existir ainda (repassamos silencioso ou log na borda real)
    }
    return purgedCount;
}
