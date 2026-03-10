# OliviaClaw

Agente local com arquitetura **core-first** e **channel-agnostic**, com integração Telegram, suporte a tools, skills e processamento de mídia (documentos/áudio).

## Arquitetura

- `src/controller`: orquestra pipeline e ciclo por ator (fila serial).
- `src/agent`: loop do agente, composição de prompt, validação de saída.
- `src/llm`: contrato único de provider + providers (`gemini`, `deepseek`, `groq`).
- `src/tools`: registry e implementações de tools.
- `src/skills`: carregamento, roteamento e resumo de skills.
- `src/media`: preprocessamento de anexos (documentos/STT).
- `src/adapters/telegram`: adaptação de entrada/saída para Telegram.
- `src/channels/contracts`: contratos normalizados de entrada/saída.
- `src/db`, `src/memory`: persistência e histórico conversacional.

## Requisitos

- Node.js 20+
- npm 10+
- Token de bot Telegram
- Pelo menos 1 provider configurado (`gemini`, `deepseek`, `groq` ou `openai`)

Opcional (degradação controlada se ausente):
- `whisper` (STT)
- `edge-tts` (TTS)
- `ffmpeg` (pipeline de mídia avançado)

## Instalação

```bash
npm install
```

## Configuração (`.env`)

Use `.env.example` como base. Variáveis principais:

- Telegram:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_ALLOWED_USER_IDS` (CSV)
  - `TELEGRAM_PRIVATE_ONLY` (`true` para aceitar só chat privado)
- Provider:
  - `DEFAULT_PROVIDER` (`gemini|deepseek|groq|openai`)
  - `GEMINI_API_KEY`
  - `DEEPSEEK_API_KEY`
  - `GROQ_API_KEY`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL` (opcional, padrão `gpt-4o`)
  - `PROVIDER_TIMEOUT_MS`
- Runtime:
  - `MAX_ITERATIONS`
  - `MEMORY_WINDOW_SIZE`
  - `MAX_QUEUE_SIZE`
  - `LOG_LEVEL`
- Paths:
  - `DB_PATH`
  - `SKILLS_DIR`
  - `TMP_DIR`
  - `ALLOWED_TOOL_ROOTS` (CSV)
- Features:
  - `ENABLE_GITHUB_PUSH`
  - `ENABLE_CODE_ANALYZER`
- Mídia:
  - `WHISPER_COMMAND`
  - `EDGE_TTS_COMMAND`
  - `INPUT_DOWNLOAD_TIMEOUT_MS`
  - `WHISPER_TIMEOUT_MS`
  - `MAX_AUDIO_MB`
  - `MAX_AUDIO_DURATION_SECONDS`
  - `MAX_TTS_CHARS`
- Web:
  - `WEB_ALLOWED_DOMAINS` (CSV de allowlist para `buscar_web`)
  - `WEB_TIMEOUT_MS`
- Limpeza de temporários:
  - `TMP_CLEANUP_INTERVAL_MS` (padrão `900000`)
  - `TMP_CLEANUP_MAX_AGE_MS` (padrão `86400000`)

## Execução local

Desenvolvimento:

```bash
npm run dev
```

Build:

```bash
npm run build
npm start
```

## Testes

Executar tudo:

```bash
npm test
```

Cobertura:

```bash
npm run test:coverage
```

## Skills

Diretório padrão: `.agents/skills`.

Cada skill deve conter `SKILL.md` com frontmatter YAML:

```yaml
---
name: nome-unico
description: descricao
version: 1.0.0
triggers:
  - /comando
tools:
  - nome_da_tool
---
Corpo markdown da skill.
```

O loader:
- ignora skills inválidas sem derrubar o processo,
- rejeita colisões de nome/trigger,
- remove tools não registradas,
- gera `availableSkillsSummary` determinístico.

## Tools

Implementações atuais:
- `criar_arquivo`
- `ler_arquivo`
- `listar_diretorio`
- `executar_comando`
- `github_push`
- `analisar_codigo`
- `buscar_web`

Execução de comando usa política DSL e validação de segurança (metacaracteres proibidos, `cwd` permitido, limites de saída).

## Fallback de providers

O bootstrap seleciona provider pelo `DEFAULT_PROVIDER`. Se o provider escolhido não estiver configurado, a inicialização falha com erro sanitizado.

Providers suportados:
- Gemini
- DeepSeek
- Groq
- OpenAI

## Fluxo Telegram

1. `TelegramInputAdapter` normaliza evento para `NormalizedInput`.
2. `AgentController`:
   - preprocessa mídia/documentos,
   - resolve conversa/skills/tools,
   - persiste mensagem pré-loop.
3. `AgentLoop` executa iterações com self-correction bounded para tool calls.
4. Controller resolve `NormalizedOutput` e persiste resposta final (apenas sucesso).
5. `TelegramOutputAdapter` entrega texto/arquivo/áudio.

## Segurança e operação

- `OutputSafetyValidator` bloqueia respostas com vazamento indevido.
- Erros técnicos são sanitizados.
- Fila por `actorId` evita concorrência por conversa.
- Cleanup periódico de `tmp/` no startup.
- Encerramento gracioso via handlers de sinal.
