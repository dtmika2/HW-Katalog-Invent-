/**
 * Gamification: experience points, derived from records the system already keeps. It only reads
 * the state; nothing else in core may import it (ESLint enforces this).
 */
export type { ActivityCategory, LedgerEntry, LedgerOptions, PoolId, RuleDef } from './types';
export { POOLS, RULES, RULE_IDS, rulePoints, type RuleId } from './rules';
export { computeLedger, totalPoints } from './ledger';
