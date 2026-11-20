import { Router } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { createRuleSchema, updateRuleSchema, type RuleDTO } from '@synerpulse/shared';
import { categories, goals, rules } from '../../db/schema';
import { db } from '../../lib/deps';
import { newId } from '../../lib/crypto';
import { badRequest, notFound, parse } from '../../lib/errors';
import { currentHousehold, currentUser, idParam, requireCap } from '../../lib/http';
import { logActivity } from '../../lib/activity';
import { getVisibleAccount } from '../accounts/service';

export const rulesRouter = Router({ mergeParams: true });

function toRuleDTO(r: typeof rules.$inferSelect): RuleDTO {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    conditions: r.conditions,
    actions: r.actions,
    timesApplied: r.timesApplied,
    lastAppliedAt: r.lastAppliedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Every id referenced by a rule must belong to this household (no cross-household references). */
async function validateRefs(householdId: string, userId: string, conditions: Record<string, unknown>, actions: Record<string, unknown>) {
  const catIds = [conditions.categoryId, actions.setCategoryId].filter((x): x is string => typeof x === 'string');
  for (const id of catIds) {
    const [c] = await db()
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.householdId, householdId)));
    if (!c) throw badRequest('A rule refers to a category outside this household');
  }
  const goal = actions.allocateToGoal as { goalId?: string } | undefined;
  if (goal?.goalId) {
    const [g] = await db()
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.id, goal.goalId), eq(goals.householdId, householdId)));
    if (!g) throw badRequest('A rule refers to a goal outside this household');
  }
  if (typeof conditions.accountId === 'string') {
    const a = await getVisibleAccount(db(), householdId, userId, conditions.accountId);
    if (a.visibility === 'private') throw badRequest('Household rules cannot target a private account');
  }
}

rulesRouter.get('/', async (req, res) => {
  const rows = await db()
    .select()
    .from(rules)
    .where(eq(rules.householdId, currentHousehold(req).id))
    .orderBy(asc(rules.priority), asc(rules.createdAt));
  res.json({ rules: rows.map(toRuleDTO) });
});

rulesRouter.post('/', requireCap('rules.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const input = parse(createRuleSchema, req.body);
  await validateRefs(h.id, user.id, input.conditions, input.actions);
  const [row] = await db()
    .insert(rules)
    .values({ id: newId(), householdId: h.id, name: input.name, enabled: input.enabled, conditions: input.conditions, actions: input.actions, createdBy: user.id })
    .returning();
  await logActivity(db(), { householdId: h.id, actorId: user.id, entityType: 'rule', entityId: row.id, action: 'created', summary: `created the automation rule “${row.name}”` });
  res.status(201).json({ rule: toRuleDTO(row) });
});

rulesRouter.patch('/:ruleId', requireCap('rules.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const id = idParam(req, 'ruleId', 'Rule');
  const input = parse(updateRuleSchema, req.body);
  const [existing] = await db()
    .select()
    .from(rules)
    .where(and(eq(rules.id, id), eq(rules.householdId, h.id)));
  if (!existing) throw notFound('Rule');
  await validateRefs(h.id, user.id, input.conditions ?? existing.conditions, input.actions ?? existing.actions);
  const [row] = await db()
    .update(rules)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(rules.id, id))
    .returning();
  await logActivity(db(), {
    householdId: h.id,
    actorId: user.id,
    entityType: 'rule',
    entityId: id,
    action: 'updated',
    summary: input.enabled === false ? `paused the rule “${row.name}”` : input.enabled === true && !existing.enabled ? `resumed the rule “${row.name}”` : `edited the rule “${row.name}”`,
  });
  res.json({ rule: toRuleDTO(row) });
});

rulesRouter.delete('/:ruleId', requireCap('rules.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const rows = await db()
    .delete(rules)
    .where(and(eq(rules.id, idParam(req, 'ruleId', 'Rule')), eq(rules.householdId, h.id)))
    .returning({ name: rules.name });
  if (!rows.length) throw notFound('Rule');
  await logActivity(db(), { householdId: h.id, actorId: currentUser(req).id, entityType: 'rule', action: 'deleted', summary: `deleted the rule “${rows[0].name}”` });
  res.status(204).end();
});
