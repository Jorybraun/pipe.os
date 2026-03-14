/**
 * ESLint Local Rules Configuration
 * 
 * This file exports custom ESLint rules defined in the .claude/.gemini/rules/ directory.
 * Required by eslint-plugin-local-rules.
 */

module.exports = {
  'recording-shell-rule': require('./.claude/.gemini/rules/recording-shell-rule.cjs'),
};
