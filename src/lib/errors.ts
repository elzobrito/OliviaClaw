/**
 * src/lib/errors.ts
 * Utilitários centralizados para tratamento, sanitização e distinção de erros.
 * 
 * Implementa a distinção clara entre:
 * 1. Internal Log Error (mantém contexto com redação de segredos e paths)
 * 2. Safe Error (seguro para expor ao Controller, Loop ou Usuário, sem vazar infraestrutura)
 */

export interface SafeErrorDetails {
    code: string;
    message: string;
    isSafe: true;
}

export class AppError extends Error {
    public readonly code: string;
    public readonly details?: Record<string, any>;
    public readonly isOperational: boolean;

    constructor(message: string, code: string = 'GENERIC_INTERNAL_ERROR', details?: Record<string, any>, isOperational = true) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.details = details;
        this.isOperational = isOperational;

        // Maintain v8 stack trace properly
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, AppError);
        }
    }

    /**
     * Retorna os detalhes do erro de maneira segura para ser gravado nos logs centrais.
     */
    public toInternalLog(): Record<string, any> {
        return {
            name: this.name,
            code: this.code,
            message: sanitizeMessageForLog(this.message),
            // Internal logs keep stack trace to help debugging, but we could redact lines.
            // Usually the logger itself will JSON stringify this.
            stack: this.stack,
            details: sanitizePayload(this.details),
        };
    }

    /**
     * Retorna um erro completamente opaco ou sanitizado seguro para o canal/usuário/controller.
     * Não expõe caminhos de arquivo absolutos, hashes ou strings sensíveis.
     */
    public toSafeError(): SafeErrorDetails {
        return {
            code: this.code,
            message: this.isOperational ? sanitizeMessageForSafeOutput(this.message) : 'An internal error occurred. Request could not be completed.',
            isSafe: true,
        };
    }
}

/**
 * Sanitiza a mensagem para output seguro (remove tokens, URLs opacas, caminhos de disco).
 */
export function sanitizeMessageForSafeOutput(msg: string): string {
    let sanitized = msg;
    // Redação de paths locais absolutos (mantém URLs intactas).
    // Windows: C:\foo\bar
    sanitized = sanitized.replace(
        /(^|[\s("'`])([a-zA-Z]:\\(?:[^\\\r\n\t :*?"<>|]+\\?)+)/g,
        (_match, prefix: string) => `${prefix}[PATH_REDACTED]`,
    );
    // Unix-like absoluto: /var/log/app.log, /home/user/project/file.ts
    // Exige separador anterior para evitar capturar trechos dentro de URLs.
    sanitized = sanitized.replace(
        /(^|[\s("'`])((?:\/(?!\/)[^\s"'`]+){2,})/g,
        (_match, prefix: string) => `${prefix}[PATH_REDACTED]`,
    );
    // Redação de keys simples
    sanitized = sanitized.replace(/(?:api_key|token|secret|password)[\s=:]+[\w\-\.]+/gi, '[SECRET_REDACTED]');
    // Redação de Base64 simples longo que poderia ser payload vazado
    sanitized = sanitized.replace(/([A-Za-z0-9+/]{40,}=*)/g, '[BASE64_DATA_REDACTED]');
    return sanitized;
}

/**
 * Sanitiza a mensagem para logs internos (pode ser o mesmo que o Safe, apenas mantemos para granularidade futura).
 */
export function sanitizeMessageForLog(msg: string): string {
    let sanitized = msg;
    sanitized = sanitized.replace(/(?:api_key|token|secret|password)[\s=:]+[\w\-\.]+/gi, '[SECRET_REDACTED]');
    return sanitized;
}

/**
 * Filtra chaves conhecidas contendo dados sensíveis de objetos de error details.
 */
export function sanitizePayload(payload: any): any {
    if (!payload) return payload;
    if (typeof payload === 'string') return sanitizeMessageForLog(payload);

    if (typeof payload === 'object') {
        if (Array.isArray(payload)) return payload.map(sanitizePayload);

        const out: any = {};
        for (const [k, v] of Object.entries(payload)) {
            if (/(secret|token|key|password|auth|authorization|cookie|session)/i.test(k)) {
                out[k] = '[REDACTED]';
            } else {
                out[k] = sanitizePayload(v);
            }
        }
        return out;
    }
    return payload;
}

/**
 * Converte qualquer Unknown e captura para um SafeErrorDetails para retornar à borda (canal/pipeline).
 */
export function toSafeError(err: unknown): SafeErrorDetails {
    if (err instanceof AppError) {
        return err.toSafeError();
    }

    // Tratamento de erros de runtime/terceiros
    const msg = err instanceof Error ? err.message : String(err);

    // Erros comuns que queremos encapsular melhor
    if (msg.includes('TIMEOUT') || msg.includes('timeout')) {
        return { code: 'TIMEOUT_ERROR', message: 'The operation timed out.', isSafe: true };
    }
    if (msg.includes('network') || msg.includes('ECONNREFUSED')) {
        return { code: 'NETWORK_ERROR', message: 'A network operation failed.', isSafe: true };
    }

    return {
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected system error occurred.',
        isSafe: true
    };
}
