import { lookup } from 'node:dns/promises';
import net from 'node:net';
import type { BaseTool } from '../BaseTool.js';
import type { ToolDefinition, ToolResult } from '../../types/index.js';

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_CHARS = 4_000;
const DEFAULT_MAX_BYTES = 180_000;
const DEFAULT_ALLOWED_DOMAINS = [
  'duckduckgo.com',
  'wikipedia.org',
  'developer.mozilla.org',
  'openai.com',
  'github.com',
];

function parseCsv(value: string | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

function isLoopbackOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((x) => Number.parseInt(x, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
  const p0 = parts[0] ?? 0;
  const p1 = parts[1] ?? 0;
  if (p0 === 10) return true;
  if (p0 === 127) return true;
  if (p0 === 169 && p1 === 254) return true;
  if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;
  if (p0 === 192 && p1 === 168) return true;
  if (p0 === 0) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80');
}

function matchesAllowedDomain(hostname: string, allowedDomains: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function htmlToText(html: string): string {
  const withoutScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const text = withoutScript
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return decodeHtmlEntities(text);
}

async function ensurePublicHost(hostname: string): Promise<void> {
  if (isLoopbackOrLocalHost(hostname)) {
    throw new Error('Host local não permitido.');
  }

  const ipType = net.isIP(hostname);
  if (ipType === 4 && isPrivateIpv4(hostname)) {
    throw new Error('IPv4 privado/loopback não permitido.');
  }
  if (ipType === 6 && isPrivateIpv6(hostname)) {
    throw new Error('IPv6 privado/loopback não permitido.');
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true });
  if (!resolved || resolved.length === 0) {
    throw new Error('Host não resolvido.');
  }
  for (const entry of resolved) {
    if (entry.family === 4 && isPrivateIpv4(entry.address)) {
      throw new Error('Destino resolve para IPv4 privado/loopback.');
    }
    if (entry.family === 6 && isPrivateIpv6(entry.address)) {
      throw new Error('Destino resolve para IPv6 privado/loopback.');
    }
  }
}

async function fetchLimitedText(url: URL, timeoutMs: number): Promise<{
  text: string;
  finalUrl: string;
  contentType: string;
  status: number;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'OliviaClaw/0.1 (+web-tool)',
        accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5',
      },
    });

    const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
    const reader = response.body?.getReader();
    if (!reader) {
      return {
        text: '',
        finalUrl: response.url,
        contentType,
        status: response.status,
      };
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > DEFAULT_MAX_BYTES) {
        break;
      }
      chunks.push(value);
    }

    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const rawText = buffer.toString('utf8');
    const normalizedText = contentType.includes('text/html')
      ? htmlToText(rawText)
      : rawText.trim();

    return {
      text: normalizedText,
      finalUrl: response.url,
      contentType,
      status: response.status,
    };
  } finally {
    clearTimeout(timer);
  }
}

export class BuscarWebTool implements BaseTool {
  readonly definition: ToolDefinition = {
    name: 'buscar_web',
    description: 'Busca informações na web com allowlist de domínios e proteções SSRF.',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        url: { type: 'string' },
        maxChars: { type: 'number' },
      },
      required: [],
      additionalProperties: false,
    },
    isGlobal: true,
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query ?? '').trim();
    const urlInput = String(args.url ?? '').trim();
    const maxChars = Math.max(200, Math.min(DEFAULT_MAX_CHARS, Number(args.maxChars ?? DEFAULT_MAX_CHARS) || DEFAULT_MAX_CHARS));
    const timeoutMs = Math.max(1000, Number(process.env.WEB_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
    const allowedDomains = parseCsv(process.env.WEB_ALLOWED_DOMAINS);
    const effectiveAllowedDomains = allowedDomains.length > 0 ? allowedDomains : DEFAULT_ALLOWED_DOMAINS;

    if (!query && !urlInput) {
      return { output: 'Informe `query` ou `url`.' };
    }

    const targetUrl = query
      ? new URL(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`)
      : new URL(urlInput);

    if (!['https:', 'http:'].includes(targetUrl.protocol)) {
      return { output: 'Somente URLs HTTP/HTTPS são permitidas.' };
    }
    if (targetUrl.username || targetUrl.password) {
      return { output: 'URL com credenciais embutidas não é permitida.' };
    }
    if (targetUrl.port && targetUrl.port !== '80' && targetUrl.port !== '443') {
      return { output: 'Porta não permitida para busca web.' };
    }

    const hostname = targetUrl.hostname.toLowerCase();
    if (!matchesAllowedDomain(hostname, effectiveAllowedDomains)) {
      return {
        output: `Domínio não permitido: ${hostname}. Ajuste WEB_ALLOWED_DOMAINS para liberar explicitamente.`,
      };
    }

    try {
      await ensurePublicHost(hostname);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'host inválido';
      return { output: `Destino bloqueado por segurança: ${message}` };
    }

    try {
      const fetched = await fetchLimitedText(targetUrl, timeoutMs);
      if (fetched.status < 200 || fetched.status >= 400) {
        return { output: `Falha HTTP ${fetched.status} ao acessar ${fetched.finalUrl}` };
      }

      const normalized = fetched.text.replace(/\s+/g, ' ').trim();
      const output = normalized.slice(0, maxChars);
      return {
        output: output.length > 0 ? output : 'Sem conteúdo textual útil.',
        metadata: {
          sourceUrl: fetched.finalUrl,
          contentType: fetched.contentType,
          queryUsed: query || undefined,
          truncated: normalized.length > output.length,
          allowedDomains: effectiveAllowedDomains,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erro desconhecido';
      return { output: `Falha ao buscar URL: ${message}` };
    }
  }
}
