import { applyBasisPoints } from '@synerpulse/shared';

/**
 * Rule-based automation (paper §2.5: "customizable tagging and rule-based automation …
 * any deposit tagged 'freelance' triggers a savings reallocation of 20%").
 * Pure and deterministic so it can be unit-tested and explained to users.
 */
export interface RuleConditions {
  type?: 'expense' | 'income';
  descriptionContains?: string;
  merchantContains?: string;
  tag?: string;
  categoryId?: string;
  accountId?: string;
  minAmountCents?: number;
  maxAmountCents?: number;
}

export interface RuleActions {
  setCategoryId?: string;
  addTags?: string[];
  allocateToGoal?: { goalId: string; basisPoints: number };
}

export interface RuleLike {
  id: string;
  name: string;
  enabled: boolean;
  conditions: RuleConditions;
  actions: RuleActions;
}

export interface TxnFacts {
  type: 'expense' | 'income';
  description: string;
  merchant: string | null;
  tags: string[];
  categoryId: string | null;
  accountId: string;
  /** Absolute amount in cents. */
  amountCents: number;
}

export interface RuleOutcome {
  categoryId: string | null;
  tags: string[];
  allocations: { ruleId: string; goalId: string; amountCents: number }[];
  appliedRuleIds: string[];
}

const contains = (haystack: string | null | undefined, needle: string) =>
  (haystack ?? '').toLocaleLowerCase().includes(needle.toLocaleLowerCase());

export function ruleMatches(c: RuleConditions, f: TxnFacts): boolean {
  if (c.type && c.type !== f.type) return false;
  if (c.descriptionContains && !contains(f.description, c.descriptionContains)) return false;
  if (c.merchantContains && !contains(f.merchant, c.merchantContains)) return false;
  if (c.tag && !f.tags.includes(c.tag.toLowerCase())) return false;
  if (c.categoryId && c.categoryId !== f.categoryId) return false;
  if (c.accountId && c.accountId !== f.accountId) return false;
  if (c.minAmountCents != null && f.amountCents < c.minAmountCents) return false;
  if (c.maxAmountCents != null && f.amountCents > c.maxAmountCents) return false;
  return true;
}

/**
 * Evaluate rules in order. Earlier rules' effects (e.g. an added tag) are visible to later rules.
 * A rule never overrides a category the user chose explicitly.
 */
export function applyRules(rules: RuleLike[], facts: TxnFacts, opts: { categoryExplicit: boolean }): RuleOutcome {
  const f: TxnFacts = { ...facts, tags: [...facts.tags] };
  const out: RuleOutcome = { categoryId: facts.categoryId, tags: f.tags, allocations: [], appliedRuleIds: [] };
  let categoryLocked = opts.categoryExplicit && facts.categoryId != null;
  for (const rule of rules) {
    if (!rule.enabled || !ruleMatches(rule.conditions, f)) continue;
    let applied = false;
    const a = rule.actions;
    if (a.setCategoryId && !categoryLocked) {
      f.categoryId = a.setCategoryId;
      out.categoryId = a.setCategoryId;
      categoryLocked = true; // first matching rule wins
      applied = true;
    }
    if (a.addTags?.length) {
      for (const t of a.addTags) {
        const tag = t.toLowerCase();
        if (!f.tags.includes(tag) && f.tags.length < 10) {
          f.tags.push(tag);
          applied = true;
        }
      }
    }
    if (a.allocateToGoal) {
      const amount = applyBasisPoints(f.amountCents, a.allocateToGoal.basisPoints);
      if (amount > 0) {
        out.allocations.push({ ruleId: rule.id, goalId: a.allocateToGoal.goalId, amountCents: amount });
        applied = true;
      }
    }
    if (applied) out.appliedRuleIds.push(rule.id);
  }
  out.tags = f.tags;
  return out;
}
