import { Router } from 'express';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  addMonths,
  can,
  createGoalSchema,
  createRecurringSchema,
  endOfMonth,
  forecastRequestSchema,
  formatCents,
  goalContributionSchema,
  markPaidSchema,
  monthKey,
  monthLabel,
  saveBudgetSchema,
  saveScenarioSchema,
  todayISO,
  updateGoalSchema,
  updateRecurringSchema,
  zMonth,
  type ScenarioDTO,
} from '@familypulse/shared';
import {
  accounts,
  budgetItems,
  budgetPlans,
  categories,
  goalContributions,
  goals,
  recurringItems,
  scenarios,
  users,
} from '../../db/schema';
import { db } from '../../lib/deps';
import { newId } from '../../lib/crypto';
import { badRequest, forbidden, notFound, parse } from '../../lib/errors';
import { assertCap, currentHousehold, currentUser, idParam, requireCap } from '../../lib/http';
import { logActivity } from '../../lib/activity';
import { budgetMonth, listGoals, listRecurring, periodTotals, planForMonth, toRecurringDTO } from '../finance/service';
import { stepAfter } from '../finance/recurrence';
import { runForecast } from '../forecast/service';
import { createTransaction } from '../transactions/service';
import { afterLedgerChange, evaluateGoals } from '../alerts/service';
import { getVisibleAccount } from '../accounts/service';

export const planningRouter = Router({ mergeParams: true });

// ================================================================ budgets
planningRouter.get('/budgets/overview', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const { months } = parse(z.object({ months: z.coerce.number().int().min(1).max(24).default(6) }), req.query);
  const today = todayISO();
  const series = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = addMonths(`${monthKey(today)}-01`, -i);
    const t = await periodTotals(db(), h.id, user.id, 'household', start, endOfMonth(start));
    series.push({ month: monthKey(start), label: monthLabel(monthKey(start)), incomeCents: t.incomeCents, spendCents: t.spendCents });
  }
  res.json({ series });
});

planningRouter.get('/budgets/:month', async (req, res) => {
  const h = currentHousehold(req);
  const month = parse(zMonth, req.params.month);
  res.json({ budget: await budgetMonth(db(), h.id, currentUser(req).id, month, todayISO()) });
});

/** Save (create or replace) the plan starting at `month`. Plans carry forward to later months. */
planningRouter.put('/budgets', requireCap('budgets.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const input = parse(saveBudgetSchema, req.body);
  if (input.items.length) {
    const cats = await db()
      .select({ id: categories.id, group: categories.group })
      .from(categories)
      .where(eq(categories.householdId, h.id));
    const valid = new Map(cats.map((c) => [c.id, c.group]));
    for (const item of input.items) {
      const g = valid.get(item.categoryId);
      if (!g) throw badRequest('A budget line refers to a category outside this household');
      if (g === 'income') throw badRequest('Budgets are set on spending categories, not income categories');
    }
  }
  await db().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(budgetPlans)
      .where(and(eq(budgetPlans.householdId, h.id), eq(budgetPlans.month, input.month)));
    const planId = existing?.id ?? newId();
    if (existing) {
      await tx.update(budgetPlans).set({ expectedIncomeCents: input.expectedIncomeCents, updatedAt: new Date() }).where(eq(budgetPlans.id, planId));
      await tx.delete(budgetItems).where(eq(budgetItems.planId, planId));
    } else {
      await tx.insert(budgetPlans).values({ id: planId, householdId: h.id, month: input.month, expectedIncomeCents: input.expectedIncomeCents, createdBy: user.id });
    }
    const items = input.items.filter((i) => i.amountCents > 0);
    if (items.length) await tx.insert(budgetItems).values(items.map((i) => ({ planId, categoryId: i.categoryId, amountCents: i.amountCents })));
    const total = items.reduce((s, i) => s + i.amountCents, 0);
    await logActivity(tx, {
      householdId: h.id,
      actorId: user.id,
      entityType: 'budget',
      entityId: planId,
      action: existing ? 'updated' : 'created',
      summary: `${existing ? 'updated' : 'set'} the budget from ${monthLabel(input.month, 'long')} (${formatCents(total, h.currency, { noCents: true })}/month)`,
    });
  });
  await afterLedgerChange(h.id);
  res.json({ budget: await budgetMonth(db(), h.id, user.id, input.month, todayISO()) });
});

/** Remove the plan that starts at `month` — the previous plan (if any) applies again ("restore"). */
planningRouter.delete('/budgets/:month', requireCap('budgets.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const month = parse(zMonth, req.params.month);
  const rows = await db()
    .delete(budgetPlans)
    .where(and(eq(budgetPlans.householdId, h.id), eq(budgetPlans.month, month)))
    .returning({ id: budgetPlans.id });
  if (!rows.length) throw notFound('Budget for that month');
  const previous = await planForMonth(db(), h.id, month);
  await logActivity(db(), {
    householdId: h.id,
    actorId: currentUser(req).id,
    entityType: 'budget',
    action: 'reset',
    summary: `reset the ${monthLabel(month, 'long')} budget${previous ? ` (the ${monthLabel(previous.plan.month, 'long')} plan applies again)` : ''}`,
  });
  res.json({ budget: await budgetMonth(db(), h.id, currentUser(req).id, month, todayISO()) });
});

// ================================================================ goals
planningRouter.get('/goals', async (req, res) => {
  const h = currentHousehold(req);
  const includeArchived = req.query.includeArchived === 'true';
  res.json({ goals: await listGoals(db(), h.id, todayISO(), includeArchived) });
});

planningRouter.post('/goals', requireCap('goals.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const input = parse(createGoalSchema, req.body);
  if (input.targetDate && input.targetDate <= todayISO()) throw badRequest('Pick a target date in the future', { targetDate: ['Must be in the future'] });
  const id = newId();
  await db()
    .insert(goals)
    .values({ id, householdId: h.id, name: input.name, icon: input.icon, targetCents: input.targetCents, targetDate: input.targetDate ?? null, plannedMonthlyCents: input.plannedMonthlyCents, createdBy: currentUser(req).id });
  await logActivity(db(), {
    householdId: h.id,
    actorId: currentUser(req).id,
    entityType: 'goal',
    entityId: id,
    action: 'created',
    summary: `created the goal “${input.name}” (${formatCents(input.targetCents, h.currency, { noCents: true })})`,
  });
  const list = await listGoals(db(), h.id, todayISO());
  res.status(201).json({ goal: list.find((g) => g.id === id) });
});

planningRouter.patch('/goals/:goalId', requireCap('goals.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const id = idParam(req, 'goalId', 'Goal');
  const input = parse(updateGoalSchema, req.body);
  const { archived, ...rest } = input;
  const rows = await db()
    .update(goals)
    .set({ ...rest, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }), updatedAt: new Date() })
    .where(and(eq(goals.id, id), eq(goals.householdId, h.id)))
    .returning({ id: goals.id, name: goals.name });
  if (!rows.length) throw notFound('Goal');
  await logActivity(db(), {
    householdId: h.id,
    actorId: currentUser(req).id,
    entityType: 'goal',
    entityId: id,
    action: archived ? 'archived' : 'updated',
    summary: `${archived ? 'archived' : 'updated'} the goal “${rows[0].name}”`,
  });
  const list = await listGoals(db(), h.id, todayISO(), true);
  res.json({ goal: list.find((g) => g.id === id) });
});

planningRouter.get('/goals/:goalId/contributions', async (req, res) => {
  const h = currentHousehold(req);
  const id = idParam(req, 'goalId', 'Goal');
  const rows = await db()
    .select({ c: goalContributions, by: users.name })
    .from(goalContributions)
    .leftJoin(users, eq(users.id, goalContributions.createdBy))
    .where(and(eq(goalContributions.goalId, id), eq(goalContributions.householdId, h.id)))
    .orderBy(desc(goalContributions.date), desc(goalContributions.createdAt))
    .limit(200);
  res.json({
    contributions: rows.map(({ c, by }) => ({
      id: c.id,
      amountCents: Number(c.amountCents),
      date: c.date,
      note: c.note,
      automatic: Boolean(c.ruleId),
      createdBy: by,
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

planningRouter.post('/goals/:goalId/contributions', requireCap('goals.contribute'), async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const id = idParam(req, 'goalId', 'Goal');
  const input = parse(goalContributionSchema, req.body);
  const [goal] = await db()
    .select()
    .from(goals)
    .where(and(eq(goals.id, id), eq(goals.householdId, h.id)));
  if (!goal) throw notFound('Goal');
  if (goal.archivedAt) throw badRequest('This goal is archived');
  if (input.date > todayISO()) throw badRequest('Contributions cannot be dated in the future');
  if (input.amountCents < 0) {
    const [{ saved }] = await db()
      .select({ saved: sql<number>`coalesce(sum(${goalContributions.amountCents}), 0)::bigint` })
      .from(goalContributions)
      .where(eq(goalContributions.goalId, id));
    if (Number(saved) + input.amountCents < 0) throw badRequest('You cannot withdraw more than has been saved');
  }
  await db()
    .insert(goalContributions)
    .values({ id: newId(), goalId: id, householdId: h.id, amountCents: input.amountCents, date: input.date, note: input.note ?? null, createdBy: user.id });
  await logActivity(db(), {
    householdId: h.id,
    actorId: user.id,
    entityType: 'goal',
    entityId: id,
    action: input.amountCents > 0 ? 'contributed' : 'withdrew',
    summary: `${input.amountCents > 0 ? 'added' : 'withdrew'} ${formatCents(Math.abs(input.amountCents), h.currency)} ${input.amountCents > 0 ? 'to' : 'from'} “${goal.name}”`,
  });
  await evaluateGoals(h.id);
  const list = await listGoals(db(), h.id, todayISO());
  res.status(201).json({ goal: list.find((g) => g.id === id) });
});

planningRouter.delete('/goals/:goalId/contributions/:contributionId', requireCap('goals.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const rows = await db()
    .delete(goalContributions)
    .where(
      and(
        eq(goalContributions.id, idParam(req, 'contributionId', 'Contribution')),
        eq(goalContributions.goalId, idParam(req, 'goalId', 'Goal')),
        eq(goalContributions.householdId, h.id),
      ),
    )
    .returning({ id: goalContributions.id });
  if (!rows.length) throw notFound('Contribution');
  res.status(204).end();
});

// ================================================================ recurring bills & income
planningRouter.get('/recurring', async (req, res) => {
  const h = currentHousehold(req);
  res.json({ items: await listRecurring(db(), h.id, currentUser(req).id) });
});

async function validateRecurringRefs(householdId: string, userId: string, input: { accountId?: string | null; categoryId?: string | null; kind?: string }, privateAllowed: boolean) {
  let visibility: 'shared' | 'private' = 'shared';
  if (input.accountId) {
    const a = await getVisibleAccount(db(), householdId, userId, input.accountId);
    visibility = a.visibility;
    if (a.visibility === 'private' && (!privateAllowed || a.ownerUserId !== userId)) throw notFound('Account');
  }
  if (input.categoryId) {
    const [c] = await db()
      .select()
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.householdId, householdId)));
    if (!c) throw badRequest('Unknown category');
    if (input.kind && (c.group === 'income') !== (input.kind === 'income')) throw badRequest('Category does not match bill/income type');
  }
  return visibility;
}

planningRouter.post('/recurring', async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const input = parse(createRecurringSchema, req.body);
  const visibility = await validateRecurringRefs(h.id, user.id, input, true);
  // Shared items need recurring.manage; members may track recurring items on their own private accounts.
  if (visibility === 'shared') assertCap(h, 'recurring.manage');
  else if (h.role === 'viewer') throw forbidden();
  const id = newId();
  const [row] = await db()
    .insert(recurringItems)
    .values({
      id,
      householdId: h.id,
      kind: input.kind,
      label: input.label,
      amountCents: input.amountCents,
      minAmountCents: input.kind === 'income' ? (input.minAmountCents ?? null) : null,
      frequency: input.frequency,
      anchorDay: Number(input.nextDate.slice(8, 10)),
      nextDate: input.nextDate,
      endDate: input.endDate ?? null,
      accountId: input.accountId ?? null,
      categoryId: input.categoryId ?? null,
      autopay: input.autopay,
      createdBy: user.id,
    })
    .returning();
  await logActivity(db(), {
    householdId: h.id,
    actorId: user.id,
    entityType: 'recurring',
    entityId: id,
    action: 'created',
    summary: `added the ${input.kind === 'bill' ? 'bill' : 'income stream'} “${input.label}”`,
    visibleToUserId: visibility === 'private' ? user.id : null,
  });
  res.status(201).json({ item: toRecurringDTO(row, null, null) });
});

async function loadRecurringForEdit(req: Parameters<typeof currentUser>[0]) {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const id = idParam(req, 'recurringId', 'Recurring item');
  const visible = await listRecurring(db(), h.id, user.id);
  const item = visible.find((r) => r.id === id);
  if (!item) throw notFound('Recurring item');
  let isPrivate = false;
  if (item.accountId) {
    const [a] = await db().select({ visibility: accounts.visibility }).from(accounts).where(eq(accounts.id, item.accountId));
    isPrivate = a?.visibility === 'private';
  }
  return { h, user, id, item, isPrivate };
}

planningRouter.patch('/recurring/:recurringId', async (req, res) => {
  const { h, user, id, item, isPrivate } = await loadRecurringForEdit(req);
  if (!isPrivate) assertCap(h, 'recurring.manage');
  else if (h.role === 'viewer') throw forbidden();
  const input = parse(updateRecurringSchema, req.body);
  const nextVisibility = await validateRecurringRefs(h.id, user.id, { ...input, kind: input.kind ?? item.kind }, isPrivate);
  if (nextVisibility === 'private' && !isPrivate) throw badRequest('Shared recurring items cannot be moved to a private account');
  const nextDate = input.nextDate ?? item.nextDate;
  const endDate = input.endDate !== undefined ? input.endDate : item.endDate;
  if (endDate && endDate < nextDate) throw badRequest('End date must be after the next date');
  const [row] = await db()
    .update(recurringItems)
    .set({
      ...input,
      ...(input.nextDate ? { anchorDay: Number(input.nextDate.slice(8, 10)) } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(recurringItems.id, id), eq(recurringItems.householdId, h.id)))
    .returning();
  await logActivity(db(), {
    householdId: h.id,
    actorId: user.id,
    entityType: 'recurring',
    entityId: id,
    action: 'updated',
    summary: `updated “${row.label}”`,
    visibleToUserId: isPrivate ? user.id : null,
  });
  res.json({ item: toRecurringDTO(row, item.accountName, item.categoryName) });
});

planningRouter.delete('/recurring/:recurringId', async (req, res) => {
  const { h, user, id, item, isPrivate } = await loadRecurringForEdit(req);
  if (!isPrivate) assertCap(h, 'recurring.manage');
  else if (h.role === 'viewer') throw forbidden();
  await db().delete(recurringItems).where(and(eq(recurringItems.id, id), eq(recurringItems.householdId, h.id)));
  await logActivity(db(), {
    householdId: h.id,
    actorId: user.id,
    entityType: 'recurring',
    entityId: null,
    action: 'deleted',
    summary: `removed “${item.label}”`,
    visibleToUserId: isPrivate ? user.id : null,
  });
  res.status(204).end();
});

/**
 * Mark the next occurrence paid/received: posts a ledger entry linked to the schedule and advances
 * the schedule. Skipping advances without posting.
 */
planningRouter.post('/recurring/:recurringId/pay', async (req, res) => {
  const { h, user, id, item, isPrivate } = await loadRecurringForEdit(req);
  if (!can(h.role, 'recurring.markPaid') && !(isPrivate && h.role !== 'viewer')) throw forbidden();
  const input = parse(markPaidSchema, req.body ?? {});
  const accountId = input.accountId ?? item.accountId;
  if (!accountId) throw badRequest('Choose the account this was paid from', { accountId: ['Required'] });
  const [r] = await db().select().from(recurringItems).where(eq(recurringItems.id, id));
  const result = await db().transaction(async (tx) => {
    const created = await createTransaction(
      tx,
      h,
      user,
      {
        accountId,
        type: item.kind === 'income' ? 'income' : 'expense',
        amountCents: input.amountCents ?? item.amountCents,
        date: input.date ?? (item.nextDate <= todayISO() ? item.nextDate : todayISO()),
        description: item.label,
        categoryId: item.categoryId,
        tags: [],
      },
      { source: 'recurring', recurringId: id },
    );
    const next = stepAfter({ frequency: r.frequency, nextDate: r.nextDate, anchorDay: r.anchorDay }, r.nextDate);
    const ended = !next || (r.endDate != null && next > r.endDate);
    await tx
      .update(recurringItems)
      .set({ nextDate: next ?? r.nextDate, active: ended ? false : r.active, updatedAt: new Date() })
      .where(eq(recurringItems.id, id));
    return created;
  });
  await afterLedgerChange(h.id);
  res.json({ transactionId: result.id });
});

planningRouter.post('/recurring/:recurringId/skip', async (req, res) => {
  const { h, user, id, item, isPrivate } = await loadRecurringForEdit(req);
  if (!can(h.role, 'recurring.markPaid') && !(isPrivate && h.role !== 'viewer')) throw forbidden();
  const [r] = await db().select().from(recurringItems).where(eq(recurringItems.id, id));
  const next = stepAfter({ frequency: r.frequency, nextDate: r.nextDate, anchorDay: r.anchorDay }, r.nextDate);
  const ended = !next || (r.endDate != null && next > r.endDate);
  await db()
    .update(recurringItems)
    .set({ nextDate: next ?? r.nextDate, active: ended ? false : r.active, updatedAt: new Date() })
    .where(eq(recurringItems.id, id));
  await logActivity(db(), {
    householdId: h.id,
    actorId: user.id,
    entityType: 'recurring',
    entityId: id,
    action: 'skipped',
    summary: `skipped the ${item.nextDate} occurrence of “${item.label}”`,
    visibleToUserId: isPrivate ? user.id : null,
  });
  res.status(204).end();
});

// ================================================================ forecast & scenarios
planningRouter.post('/forecast', async (req, res) => {
  const h = currentHousehold(req);
  const input = parse(forecastRequestSchema, req.body ?? {});
  res.json({ forecast: await runForecast(db(), h.id, currentUser(req).id, input) });
});

function toScenarioDTO(s: typeof scenarios.$inferSelect, by: string | null): ScenarioDTO {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    horizonMonths: s.horizonMonths as ScenarioDTO['horizonMonths'],
    granularity: s.granularity,
    incomeMode: s.incomeMode,
    adjustments: s.adjustments as ScenarioDTO['adjustments'],
    createdBy: s.createdBy ? { id: s.createdBy, name: by ?? 'Former member' } : null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

planningRouter.get('/scenarios', async (req, res) => {
  const h = currentHousehold(req);
  const rows = await db()
    .select({ s: scenarios, by: users.name })
    .from(scenarios)
    .leftJoin(users, eq(users.id, scenarios.createdBy))
    .where(eq(scenarios.householdId, h.id))
    .orderBy(asc(scenarios.name));
  res.json({ scenarios: rows.map(({ s, by }) => toScenarioDTO(s, by)) });
});

planningRouter.post('/scenarios', requireCap('scenarios.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const input = parse(saveScenarioSchema, req.body);
  const [row] = await db()
    .insert(scenarios)
    .values({ id: newId(), householdId: h.id, ...input, description: input.description ?? null, createdBy: user.id })
    .returning();
  await logActivity(db(), { householdId: h.id, actorId: user.id, entityType: 'scenario', entityId: row.id, action: 'created', summary: `saved the scenario “${row.name}”` });
  res.status(201).json({ scenario: toScenarioDTO(row, user.name) });
});

planningRouter.put('/scenarios/:scenarioId', requireCap('scenarios.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const user = currentUser(req);
  const input = parse(saveScenarioSchema, req.body);
  const [row] = await db()
    .update(scenarios)
    .set({ ...input, description: input.description ?? null, updatedAt: new Date() })
    .where(and(eq(scenarios.id, idParam(req, 'scenarioId', 'Scenario')), eq(scenarios.householdId, h.id)))
    .returning();
  if (!row) throw notFound('Scenario');
  res.json({ scenario: toScenarioDTO(row, user.name) });
});

planningRouter.delete('/scenarios/:scenarioId', requireCap('scenarios.manage'), async (req, res) => {
  const h = currentHousehold(req);
  const rows = await db()
    .delete(scenarios)
    .where(and(eq(scenarios.id, idParam(req, 'scenarioId', 'Scenario')), eq(scenarios.householdId, h.id)))
    .returning({ name: scenarios.name });
  if (!rows.length) throw notFound('Scenario');
  await logActivity(db(), { householdId: h.id, actorId: currentUser(req).id, entityType: 'scenario', action: 'deleted', summary: `deleted the scenario “${rows[0].name}”` });
  res.status(204).end();
});
