import type { LanguageSupportDecision } from './model';

const LANGUAGE_ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  javascript: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  node: 'javascript',
  nodejs: 'javascript',
  py: 'python',
  golang: 'go',
  rs: 'rust',
  kt: 'kotlin',
  kts: 'kotlin',
  rb: 'ruby',
};

const PRODUCTION_PARSERS: Record<string, string> = {
  typescript: 'typescript-compiler-api',
  javascript: 'typescript-compiler-api',
  python: 'python-ast-symtable',
  go: 'go-parser-types-packages',
};

const STRUCTURAL_PARSERS: Record<string, string> = {
  rust: 'tree-sitter-rust',
  java: 'tree-sitter-java',
  kotlin: 'tree-sitter-kotlin',
  ruby: 'tree-sitter-ruby',
};

export function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase().replace(/[._ -]+/g, '');
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

export function getLanguageSupport(language: string): LanguageSupportDecision {
  const normalizedLanguage = normalizeLanguage(language);
  const productionParser = PRODUCTION_PARSERS[normalizedLanguage];
  if (productionParser) {
    return {
      language,
      normalizedLanguage,
      level: 'production',
      parser: productionParser,
      challengePacketsAllowed: true,
      reason: `${normalizedLanguage} has a validated semantic extraction adapter`,
    };
  }

  const structuralParser = STRUCTURAL_PARSERS[normalizedLanguage];
  if (structuralParser) {
    return {
      language,
      normalizedLanguage,
      level: 'structural_only',
      parser: structuralParser,
      challengePacketsAllowed: false,
      reason: `${normalizedLanguage} is searchable through structural extraction but is not validated for challenge packets`,
    };
  }

  return {
    language,
    normalizedLanguage,
    level: 'unsupported',
    parser: null,
    challengePacketsAllowed: false,
    reason: `${normalizedLanguage || 'unknown'} has no configured extraction adapter`,
  };
}

