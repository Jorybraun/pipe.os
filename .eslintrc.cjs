module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh', 'local-rules'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        'argsIgnorePattern': '^_*',
        'varsIgnorePattern': '^_*',
        'caughtErrorsIgnorePattern': '^_*'
      }
    ],
    // Code quality standards - no `any` type
    '@typescript-eslint/no-explicit-any': 'error',
    // Encourage explicit return types on exported functions
    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true,
      },
    ],
    'local-rules/recording-shell-rule': 'error',
  },
  overrides: [
    {
      files: ['*.js'],
      parserOptions: {
        sourceType: 'script',
      },
      settings: {
        'local-rules/rules-dir': '.gemini/rules',
      },
    },
  ],
}
