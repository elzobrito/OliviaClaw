/**
 * TASK-019 — Contrato e política de skills
 *
 * Define o frontmatter canônico de SKILL.md, o shape do objeto Skill carregado,
 * regras de unicidade, tolerância a erro e proibições de segurança.
 */

// ---------------------------------------------------------------------------
// Frontmatter YAML canônico de SKILL.md
// ---------------------------------------------------------------------------

/**
 * Shape do frontmatter YAML declarado em cada arquivo SKILL.md.
 * Campos obrigatórios: name, description, version.
 * Campos opcionais: triggers, tools.
 */
export interface SkillFrontmatter {
  /** Nome único da skill. Usado como chave de lookup. Ex.: "summarize", "translate". */
  name: string;

  /** Descrição humana da skill. Usada para seleção por LLM quando sem trigger explícito. */
  description: string;

  /**
   * Lista de triggers explícitos (palavras-chave ou prefixos de comando).
   * Ex.: ["/summarize", "resumir", "summarize"].
   * Opcional — skill sem triggers só é ativada por correspondência semântica do LLM.
   */
  triggers?: string[];

  /**
   * Lista de nomes de tools que esta skill requer.
   * Deve referenciar apenas tools já registradas no ToolRegistry.
   * Uma skill NÃO pode declarar tools inexistentes para ampliar privilégios.
   */
  tools?: string[];

  /** Versão semântica da skill. Ex.: "1.0.0". */
  version: string;
}

// ---------------------------------------------------------------------------
// Objeto Skill carregado (após parse e validação)
// ---------------------------------------------------------------------------

export interface Skill {
  /** Nome único, derivado do frontmatter. */
  name: string;

  /** Descrição, derivada do frontmatter. */
  description: string;

  /** Triggers, normalizados para lowercase. Vazio se não declarados. */
  triggers: string[];

  /**
   * Tools requeridas, filtradas para apenas as registradas no ToolRegistry.
   * Tools declaradas mas não registradas são silenciosamente removidas e logadas.
   */
  tools: string[];

  /** Versão da skill. */
  version: string;

  /**
   * Conteúdo do corpo do SKILL.md (após o frontmatter) usado como skillSystemPrompt.
   * Injetado no contexto de sistema quando a skill é ativada.
   */
  skillSystemPrompt: string;

  /** Caminho absoluto do arquivo .md de origem. Para auditoria e hot-reload. */
  filePath: string;
}

// ---------------------------------------------------------------------------
// Resultado do carregamento de uma skill
// ---------------------------------------------------------------------------

export type SkillLoadResult =
  | { ok: true; skill: Skill }
  | { ok: false; reason: SkillLoadError; filePath: string };

export type SkillLoadError =
  | 'frontmatter_missing'       // Arquivo sem bloco --- frontmatter ---
  | 'frontmatter_invalid_yaml'  // YAML malformado
  | 'frontmatter_missing_field' // Campo obrigatório ausente (name, description, version)
  | 'name_duplicate'            // Outra skill com o mesmo name já foi carregada
  | 'trigger_collision'         // Trigger já registrado por outra skill
  | 'body_empty';               // Corpo da skill (skillSystemPrompt) vazio

// ---------------------------------------------------------------------------
// Roteamento de skills
// ---------------------------------------------------------------------------

/**
 * Resultado da decisão do router ao selecionar uma skill para uma mensagem.
 */
export type SkillRouteDecision =
  | { matched: true; skill: Skill; matchType: 'explicit_trigger' | 'semantic' }
  | { matched: false; fallback: 'llm_default' };

// ---------------------------------------------------------------------------
// Contrato do loader de skills
// ---------------------------------------------------------------------------

export interface ISkillLoader {
  /**
   * Carrega todas as skills do diretório configurado (SKILLS_DIR).
   *
   * Contrato:
   * - Nunca lança exceção — erros de arquivos individuais são retornados como SkillLoadResult ok=false.
   * - Skills com frontmatter inválido são ignoradas e logadas.
   * - Em caso de name duplicado, a segunda skill é rejeitada (primeira vence).
   * - Em caso de trigger collision, a skill com o trigger conflitante é rejeitada.
   * - Tools declaradas mas não registradas no ToolRegistry são removidas do campo tools da skill.
   */
  load(): Promise<{ skills: Skill[]; errors: SkillLoadResult[] }>;

  /**
   * Retorna a skill ativa para uma mensagem, ou fallback.
   * Preferência: correspondência explícita por trigger > correspondência semântica > fallback LLM.
   */
  route(input: string): SkillRouteDecision;
}
