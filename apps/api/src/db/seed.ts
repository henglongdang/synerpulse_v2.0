/**
 * Development seed: ONE clearly-labelled, entirely fictional household.
 * Names echo the personas in the prototype's user-flow diagram (Mary, Power, Luna, Liam).
 * All amounts are generated from a seeded PRNG relative to today's date; no real data is used.
 */
import { and, eq } from 'drizzle-orm';
import { addDays, addMonths, monthKey, startOfMonth, todayISO, type ISODate } from '@familypulse/shared';
import type { DB, Tx } from './client';
import {
  accounts,
  budgetItems,
  budgetPlans,
  categories,
  commentMentions,
  goalContributions,
  goals,
  householdMembers,
  households,
  memberCategoryScopes,
  recurringItems,
  rules,
  scenarios,
  transactionComments,
  users,
} from './schema';
import { hashPassword, newId } from '../lib/crypto';
import { createHousehold } from '../modules/households/service';
import { createTransaction, createTransfer, updateTransaction } from '../modules/transactions/service';
import { stepAfter } from '../modules/finance/recurrence';
import type { AuthUser, HouseholdCtx } from '../lib/http';

export const SAMPLE_PASSWORD = 'familypulse-demo';
export const SAMPLE_USERS = [
  { key: 'mary', name: 'Mary Okafor', email: 'mary@sample.familypulse.test', role: 'owner' },
  { key: 'power', name: 'Power Lin', email: 'power@sample.familypulse.test', role: 'admin' },
  { key: 'luna', name: 'Luna Okafor-Lin', email: 'luna@sample.familypulse.test', role: 'contributor' },
  { key: 'liam', name: 'Liam Okafor-Lin', email: 'liam@sample.familypulse.test', role: 'viewer' },
] as const;

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function sampleExists(db: DB): Promise<boolean> {
  const rows = await db.select({ id: households.id }).from(households).where(eq(households.isSample, true)).limit(1);
  return rows.length > 0;
}

export async function seed(db: DB, today: ISODate = todayISO()): Promise<{ householdId: string }> {
  const rand = prng(20250622);
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];

  const passwordHash = await hashPassword(SAMPLE_PASSWORD);
  const u: Record<string, AuthUser> = {};
  for (const s of SAMPLE_USERS) {
    const id = newId();
    await db.insert(users).values({ id, name: s.name, email: s.email, passwordHash });
    u[s.key] = { id, name: s.name, email: s.email };
  }

  return db.transaction(async (tx: Tx) => {
    const householdId = await createHousehold(tx, { name: 'Okafor-Lin Household', currency: 'USD', ownerId: u.mary.id, isSample: true });
    await tx.update(households).set({ onboardedAt: new Date() }).where(eq(households.id, householdId));
    for (const s of SAMPLE_USERS.filter((x) => x.role !== 'owner')) {
      await tx.insert(householdMembers).values({ householdId, userId: u[s.key].id, role: s.role });
    }
    for (const s of SAMPLE_USERS) await tx.update(users).set({ lastHouseholdId: householdId }).where(eq(users.id, u[s.key].id));

    const cats = await tx.select().from(categories).where(eq(categories.householdId, householdId));
    const cat = (name: string) => {
      const c = cats.find((x) => x.name === name);
      if (!c) throw new Error(`seed: missing category ${name}`);
      return c.id;
    };
    // Luna (teen contributor) may only edit groceries and dining out — the paper's "category-scoped" access example.
    await tx.insert(memberCategoryScopes).values([
      { householdId, userId: u.luna.id, categoryId: cat('Groceries') },
      { householdId, userId: u.luna.id, categoryId: cat('Dining out') },
    ]);

    const ctx = (user: AuthUser, role: HouseholdCtx['role'] = 'owner'): HouseholdCtx => ({
      id: householdId,
      name: 'Okafor-Lin Household',
      currency: 'USD',
      isSample: true,
      role,
      categoryScope: [],
    });
    const H = ctx(u.mary);
    const HP = ctx(u.power, 'admin');

    const opening = addMonths(startOfMonth(today), -6);
    const acct = async (name: string, type: (typeof accounts.$inferInsert)['type'], openingBalanceCents: number, extra: Partial<typeof accounts.$inferInsert> = {}) => {
      const id = newId();
      await tx.insert(accounts).values({ id, householdId, ownerUserId: u.mary.id, name, type, openingBalanceCents, openingDate: opening, ...extra });
      return id;
    };
    const checking = await acct('Joint Checking', 'checking', 6_420_00, { institution: 'Harbor Credit Union', last4: '4417' });
    const savings = await acct('Joint Savings', 'savings', 18_250_00, { institution: 'Harbor Credit Union', last4: '9032' });
    const card = await acct('Family Visa', 'credit_card', -1_184_37, { institution: 'Northwind Card', last4: '5413', creditLimitCents: 15_000_00 });
    const carLoan = await acct('Car loan', 'loan', -14_600_00, { institution: 'Harbor Credit Union' });
    const brokerage = await acct('Index fund brokerage', 'investment', 31_900_00, { institution: 'Sample Brokerage' });
    const fun = await acct('Power – personal', 'checking', 1_240_00, { ownerUserId: u.power.id, visibility: 'private', institution: 'Online Bank' });

    // ---------------- goals & rules (before transactions so rules fire during the seed) ----------------
    const eduGoal = newId();
    const homeGoal = newId();
    await tx.insert(goals).values([
      { id: eduGoal, householdId, name: 'Education fund', icon: 'education', targetCents: 30_000_00, targetDate: addMonths(today, 20), plannedMonthlyCents: 150_00, createdBy: u.mary.id },
      { id: homeGoal, householdId, name: 'Mortgage down payment', icon: 'home', targetCents: 60_000_00, targetDate: addMonths(today, 26), plannedMonthlyCents: 400_00, createdBy: u.mary.id },
      { id: newId(), householdId, name: 'Emergency cushion', icon: 'emergency', targetCents: 12_000_00, targetDate: null, plannedMonthlyCents: 200_00, createdBy: u.power.id },
    ]);
    await tx.insert(goalContributions).values([
      { id: newId(), goalId: eduGoal, householdId, amountCents: 26_150_00, date: opening, note: 'Opening balance (529 plan)', createdBy: u.mary.id },
      { id: newId(), goalId: homeGoal, householdId, amountCents: 41_300_00, date: opening, note: 'Opening balance', createdBy: u.mary.id },
    ]);
    const [emergency] = await tx.select().from(goals).where(and(eq(goals.householdId, householdId), eq(goals.icon, 'emergency')));
    await tx.insert(goalContributions).values({ id: newId(), goalId: emergency.id, householdId, amountCents: 3_100_00, date: opening, note: 'Opening balance', createdBy: u.power.id });

    await tx.insert(rules).values([
      {
        id: newId(),
        householdId,
        name: 'Freelance → 20% to the down payment',
        conditions: { type: 'income', tag: 'freelance' },
        actions: { allocateToGoal: { goalId: homeGoal, basisPoints: 2000 } },
        priority: 10,
        createdBy: u.power.id,
      },
      {
        id: newId(),
        householdId,
        name: 'Tag client payments as freelance',
        conditions: { type: 'income', descriptionContains: 'invoice' },
        actions: { addTags: ['freelance'], setCategoryId: cat('Freelance') },
        priority: 0,
        createdBy: u.power.id,
      },
      {
        id: newId(),
        householdId,
        name: 'Green Basket is groceries',
        conditions: { type: 'expense', merchantContains: 'green basket' },
        actions: { setCategoryId: cat('Groceries') },
        priority: 1,
        createdBy: u.mary.id,
      },
    ]);

    // ---------------- recurring income & bills ----------------
    type Rec = { label: string; kind: 'income' | 'bill'; amount: number; min?: number; frequency: (typeof recurringItems.$inferInsert)['frequency']; first: ISODate; category: string; account: string; autopay?: boolean };
    const recs: Rec[] = [
      { label: 'Mary – salary', kind: 'income', amount: 2_950_00, frequency: 'biweekly', first: addDays(opening, 4), category: 'Salary', account: checking },
      { label: 'Rent', kind: 'bill', amount: 2_400_00, frequency: 'monthly', first: `${opening.slice(0, 8)}01`, category: 'Housing', account: checking },
      { label: 'Electric & water', kind: 'bill', amount: 186_40, frequency: 'monthly', first: `${opening.slice(0, 8)}12`, category: 'Utilities', account: checking, autopay: true },
      { label: 'Internet', kind: 'bill', amount: 70_00, frequency: 'monthly', first: `${opening.slice(0, 8)}18`, category: 'Utilities', account: card, autopay: true },
      { label: 'Phone plan', kind: 'bill', amount: 95_00, frequency: 'monthly', first: `${opening.slice(0, 8)}22`, category: 'Utilities', account: card, autopay: true },
      { label: 'Car insurance', kind: 'bill', amount: 212_00, frequency: 'monthly', first: `${opening.slice(0, 8)}05`, category: 'Insurance', account: checking },
      { label: 'Daycare tuition', kind: 'bill', amount: 640_00, frequency: 'monthly', first: `${opening.slice(0, 8)}03`, category: 'Childcare & education', account: checking },
    ];
    const recIds: Record<string, string> = {};
    for (const r of recs) {
      const id = newId();
      recIds[r.label] = id;
      await tx.insert(recurringItems).values({
        id,
        householdId,
        kind: r.kind,
        label: r.label,
        amountCents: r.amount,
        minAmountCents: r.min ?? null,
        frequency: r.frequency,
        anchorDay: Number(r.first.slice(8, 10)),
        nextDate: r.first,
        accountId: r.account,
        categoryId: cat(r.category),
        autopay: r.autopay ?? false,
        createdBy: u.mary.id,
      });
      // Post every past occurrence and advance the schedule — exactly what "mark paid" does.
      let d: ISODate | null = r.first;
      while (d && d <= today) {
        const variance = r.label === 'Electric & water' ? between(-3500, 4200) : 0;
        await createTransaction(
          tx,
          H,
          u.mary,
          { accountId: r.account, type: r.kind === 'income' ? 'income' : 'expense', amountCents: r.amount + variance, date: d, description: r.label, categoryId: cat(r.category), tags: [] },
          { source: 'recurring', recurringId: id, skipActivity: true },
        );
        d = stepAfter({ frequency: r.frequency, nextDate: r.first, anchorDay: Number(r.first.slice(8, 10)) }, d);
      }
      await tx.update(recurringItems).set({ nextDate: d ?? r.first }).where(eq(recurringItems.id, id));
    }
    // Power's freelance income is irregular: modelled as a monthly expectation with a conservative floor.
    const freelanceId = newId();
    await tx.insert(recurringItems).values({
      id: freelanceId,
      householdId,
      kind: 'income',
      label: 'Power – freelance (expected)',
      amountCents: 3_200_00,
      minAmountCents: 1_200_00,
      frequency: 'monthly',
      anchorDay: 25,
      nextDate: addMonths(`${today.slice(0, 8)}25`, today.slice(8, 10) >= '25' ? 1 : 0),
      accountId: checking,
      categoryId: cat('Freelance'),
      createdBy: u.power.id,
    });

    // ---------------- six months of everyday life ----------------
    const add = (user: AuthUser, h: HouseholdCtx, input: Parameters<typeof createTransaction>[3]) =>
      createTransaction(tx, h, user, input, { skipActivity: true });
    const groceryStores = ['Green Basket Market', 'Corner Co-op', 'FreshMart'];
    const restaurants = ['Saffron Kitchen', 'Noodle Bar 88', 'Harbor Pizza', 'Taqueria Sol', 'Blue Door Café'];
    for (let d = addDays(opening, 1); d <= today; d = addDays(d, 1)) {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      const day = Number(d.slice(8, 10));
      if (dow === 6) {
        const store = pick(groceryStores);
        await add(pick([u.mary, u.power]), H, { accountId: rand() < 0.7 ? checking : card, type: 'expense', amountCents: between(118_00, 236_00), date: d, description: 'Weekly groceries', merchant: store, categoryId: store.startsWith('Green') ? null : cat('Groceries'), tags: [] });
      }
      if (rand() < 0.16) {
        // Dining out runs hotter in the current month — this is what the "higher than usual" tip notices.
        const hot = monthKey(d) === monthKey(today) ? 1.8 : 1;
        await add(pick([u.mary, u.power, u.luna]), H, { accountId: card, type: 'expense', amountCents: Math.round(between(24_00, 86_00) * hot), date: d, description: 'Dinner out', merchant: pick(restaurants), categoryId: cat('Dining out'), tags: [] });
      }
      if (dow === 2 && rand() < 0.6) await add(u.power, H, { accountId: card, type: 'expense', amountCents: between(38_00, 64_00), date: d, description: 'Gas', merchant: 'Northside Fuel', categoryId: cat('Transportation'), tags: [] });
      if (rand() < 0.05) await add(u.mary, H, { accountId: card, type: 'expense', amountCents: between(30_00, 140_00), date: d, description: pick(['Movie night', 'Museum tickets', 'Concert', 'Bowling']), categoryId: cat('Entertainment'), tags: [] });
      if (rand() < 0.035) await add(u.mary, H, { accountId: card, type: 'expense', amountCents: between(25_00, 120_00), date: d, description: pick(['Kids shoes', 'Winter jacket', 'School clothes']), categoryId: cat('Clothing'), tags: [] });
      if (day === 9) await add(u.mary, H, { accountId: card, type: 'expense', amountCents: 15_49, date: d, description: 'StreamFlix', merchant: 'StreamFlix', categoryId: cat('Subscriptions'), tags: [] });
      if (day === 14) await add(u.luna, ctx(u.luna, 'owner'), { accountId: card, type: 'expense', amountCents: 9_99, date: d, description: 'Fortnite crew pack', merchant: 'Fortnite', categoryId: cat('Entertainment'), tags: [] });
      if (day === 16) await add(u.mary, H, { accountId: card, type: 'expense', amountCents: 11_99, date: d, description: 'Music subscription', merchant: 'TuneBox', categoryId: cat('Subscriptions'), tags: [] });
      if (day === 20) await createTransfer(tx, H, u.mary, { fromAccountId: checking, toAccountId: card, amountCents: between(900_00, 1_400_00), date: d, description: 'Card payment' });
      if (day === 21) await createTransfer(tx, H, u.mary, { fromAccountId: checking, toAccountId: carLoan, amountCents: 380_00, date: d, description: 'Car loan payment' });
      if (day === 26) await createTransfer(tx, H, u.mary, { fromAccountId: checking, toAccountId: savings, amountCents: 400_00, date: d, description: 'Monthly savings' });
      // Freelance invoices: 1–3 per month at irregular amounts (the paper's volatile-income persona).
      if ((day === 7 || day === 19 || day === 27) && rand() < 0.6) {
        await add(u.power, HP, { accountId: checking, type: 'income', amountCents: between(650_00, 2_300_00), date: d, description: `Client invoice #${between(1040, 1999)}`, merchant: pick(['Atlas Design Co.', 'Brightline Media', 'Kestrel Labs']), tags: [] });
      }
      if (rand() < 0.012) await add(u.mary, H, { accountId: card, type: 'expense', amountCents: between(40_00, 180_00), date: d, description: 'Pharmacy & copay', categoryId: cat('Medical'), tags: [] });
      if (dow === 5 && rand() < 0.5) await add(u.power, HP, { accountId: fun, type: 'expense', amountCents: between(12_00, 60_00), date: d, description: pick(['Climbing gym', 'Records', 'Board game']), categoryId: cat('Entertainment'), tags: [] });
    }
    // One unexpected event two months ago.
    const repairDate = addDays(addMonths(startOfMonth(today), -2), 11);
    const repair = await add(u.power, HP, { accountId: card, type: 'expense', amountCents: 642_18, date: repairDate, description: 'Brake repair', merchant: 'Eastside Auto', categoryId: cat('Repairs'), tags: ['car'] });
    // Investment statement updates (market value changes are recorded as adjustments).
    await createTransaction(tx, H, u.mary, { accountId: brokerage, type: 'income', amountCents: 412_55, date: addDays(startOfMonth(today), -1), description: 'Quarterly dividend', categoryId: cat('Investment income'), tags: [] }, { skipActivity: true });

    // ---------------- collaboration artefacts: an edit history and a comment thread ----------------
    await updateTransaction(tx, HP, u.power, repair.id, { expectedVersion: 1, amountCents: 618_18, notes: 'Shop gave us a $24 loyalty discount after the fact.' });
    const commentId = newId();
    await tx.insert(transactionComments).values({ id: commentId, transactionId: repair.id, householdId, authorId: u.mary.id, body: '@Power is this the final invoice? Want to make sure we claim the warranty on the pads.' });
    await tx.insert(commentMentions).values({ commentId, userId: u.power.id });
    await tx.insert(transactionComments).values({ id: newId(), transactionId: repair.id, householdId, authorId: u.power.id, body: 'Yes — final. Warranty card is attached to the paper receipt in the glovebox.' });

    // ---------------- budget (set in the wizard six months ago, revised this month) ----------------
    const plan = async (month: string, expectedIncome: number, lines: [string, number][]) => {
      const id = newId();
      await tx.insert(budgetPlans).values({ id, householdId, month, expectedIncomeCents: expectedIncome, createdBy: u.mary.id });
      await tx.insert(budgetItems).values(lines.map(([name, amt]) => ({ planId: id, categoryId: cat(name), amountCents: amt })));
    };
    const baseLines: [string, number][] = [
      ['Groceries', 780_00], ['Housing', 2_400_00], ['Utilities', 360_00], ['Transportation', 220_00], ['Insurance', 212_00],
      ['Childcare & education', 640_00], ['Clothing', 120_00], ['Health', 60_00],
      ['Dining out', 320_00], ['Entertainment', 160_00], ['Subscriptions', 40_00], ['Travel', 100_00],
      ['Repairs', 150_00], ['Medical', 80_00], ['Miscellaneous', 60_00],
    ];
    await plan(monthKey(opening), 9_400_00, baseLines);
    await plan(monthKey(today), 9_600_00, baseLines.map(([n, a]) => [n, n === 'Groceries' ? 820_00 : n === 'Dining out' ? 280_00 : a]));

    await tx.insert(scenarios).values({
      id: newId(),
      householdId,
      name: 'Freelance slows by 30%',
      description: 'What if client work drops for a quarter? (paper evaluation task 2)',
      horizonMonths: 6,
      granularity: 'month',
      incomeMode: 'expected',
      adjustments: [{ kind: 'income_change', recurringId: freelanceId, basisPoints: -3000 }],
      createdBy: u.power.id,
    });
    void recIds;
    return { householdId };
  });
}
