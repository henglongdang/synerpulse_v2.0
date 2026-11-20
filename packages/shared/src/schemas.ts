import { z } from 'zod';
import {
  ACCOUNT_TYPES,
  ACCOUNT_VISIBILITY,
  CATEGORY_GROUPS,
  FREQUENCIES,
  RECURRING_KINDS,
  SCOPES,
  SUPPORTED_CURRENCIES,
} from './constants';
import { isValidISODate, isValidMonthKey, isValidTimeZone } from './dates';
import { MAX_ABS_CENTS } from './money';

// ---------- primitives ----------
export const zId = z.string().uuid({ message: 'Invalid identifier' });
export const zISODate = z.string().refine(isValidISODate, { message: 'Use a valid date (YYYY-MM-DD)' });
export const zMonth = z.string().refine(isValidMonthKey, { message: 'Use a valid month (YYYY-MM)' });
export const zPositiveCents = z
  .number({ message: 'Amount must be a number' })
  .int('Amount must be in whole cents')
  .positive('Amount must be greater than zero')
  .max(MAX_ABS_CENTS, 'Amount is too large');
export const zNonNegativeCents = z.number().int().min(0, 'Amount cannot be negative').max(MAX_ABS_CENTS);
export const zSignedCents = z.number().int().min(-MAX_ABS_CENTS).max(MAX_ABS_CENTS);
export const zBasisPoints = z.number().int().min(-10_000).max(10_000);
const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);
export const zTag = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(32, 'Tags must be at most 32 characters')
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u, 'Tags may contain letters, numbers, spaces, - and _');
export const zEmail = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
export const zPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

// ---------- auth ----------
export const registerSchema = z.object({
  name: trimmed(1, 80, 'Name'),
  email: zEmail,
  password: zPassword,
});
export const loginSchema = z.object({ email: zEmail, password: z.string().min(1, 'Password is required').max(128) });
export const forgotPasswordSchema = z.object({ email: zEmail });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: zPassword });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: zPassword });
export const updateProfileSchema = z.object({ name: trimmed(1, 80, 'Name') });
export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) });

// ---------- households ----------
export const zTimeZone = z.string().max(64).refine(isValidTimeZone, { message: 'Unknown time zone' });
export const createHouseholdSchema = z.object({
  name: trimmed(1, 80, 'Household name'),
  currency: z.enum(SUPPORTED_CURRENCIES).default('USD'),
  /** IANA zone; the web app sends the creator's browser zone. Drives the household's "today". */
  timezone: zTimeZone.default('UTC'),
});
// Explicit (no defaults): in Zod 4, `.partial()` keeps defaults, so a rename-only PATCH would
// silently reset currency/time zone.
export const updateHouseholdSchema = z.object({
  name: trimmed(1, 80, 'Household name').optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  timezone: zTimeZone.optional(),
});
export const inviteSchema = z.object({
  email: zEmail.optional(),
  role: z.enum(['admin', 'contributor', 'viewer']),
  categoryScope: z.array(zId).max(50).optional(),
});
export const updateMemberSchema = z.object({
  role: z.enum(['admin', 'contributor', 'viewer']).optional(),
  categoryScope: z.array(zId).max(50).optional(),
});
export const transferOwnershipSchema = z.object({ userId: zId });

// ---------- accounts ----------
export const createAccountSchema = z.object({
  name: trimmed(1, 60, 'Account name'),
  type: z.enum(ACCOUNT_TYPES),
  visibility: z.enum(ACCOUNT_VISIBILITY).default('shared'),
  institution: z.string().trim().max(60).optional().nullable(),
  last4: z
    .string()
    .regex(/^\d{4}$/, 'Use the last 4 digits only')
    .optional()
    .nullable(),
  /** Signed: assets positive, debts negative (e.g. a $500 card balance is -50000). */
  openingBalanceCents: zSignedCents.default(0),
  openingDate: zISODate,
  creditLimitCents: zNonNegativeCents.optional().nullable(),
});
export const updateAccountSchema = z.object({
  name: trimmed(1, 60, 'Account name').optional(),
  institution: z.string().trim().max(60).optional().nullable(),
  last4: z.string().regex(/^\d{4}$/).optional().nullable(),
  creditLimitCents: zNonNegativeCents.optional().nullable(),
  archived: z.boolean().optional(),
});
export const balanceUpdateSchema = z.object({
  balanceCents: zSignedCents,
  date: zISODate,
  note: z.string().trim().max(200).optional(),
});

// ---------- categories ----------
export const createCategorySchema = z.object({
  name: trimmed(1, 40, 'Category name'),
  group: z.enum(CATEGORY_GROUPS),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
export const updateCategorySchema = createCategorySchema.partial().extend({ archived: z.boolean().optional() });

// ---------- transactions ----------
const txnCore = {
  accountId: zId,
  amountCents: zPositiveCents,
  date: zISODate,
  description: trimmed(1, 120, 'Description'),
  merchant: z.string().trim().max(80).optional().nullable(),
  categoryId: zId.optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  tags: z.array(zTag).max(10, 'At most 10 tags').default([]),
};
export const createTransactionSchema = z.object({
  ...txnCore,
  type: z.enum(['expense', 'income']),
  /** Client-generated idempotency key — retries (e.g. offline sync) never create duplicates. */
  clientRequestId: zId.optional(),
});
export const updateTransactionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  type: z.enum(['expense', 'income']).optional(),
  accountId: zId.optional(),
  amountCents: zPositiveCents.optional(),
  date: zISODate.optional(),
  description: trimmed(1, 120, 'Description').optional(),
  merchant: z.string().trim().max(80).optional().nullable(),
  categoryId: zId.optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  tags: z.array(zTag).max(10).optional(),
});
export const createTransferSchema = z
  .object({
    fromAccountId: zId,
    toAccountId: zId,
    amountCents: zPositiveCents,
    date: zISODate,
    description: trimmed(1, 120, 'Description').default('Transfer'),
    clientRequestId: zId.optional(),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    message: 'Choose two different accounts',
    path: ['toAccountId'],
  });
export const revertTransactionSchema = z.object({ version: z.number().int().positive(), expectedVersion: z.number().int().positive() });

export const listTransactionsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(80).optional(),
  accountId: zId.optional(),
  categoryId: z.union([zId, z.literal('uncategorized')]).optional(),
  type: z.enum(['expense', 'income', 'transfer', 'adjustment']).optional(),
  from: zISODate.optional(),
  to: zISODate.optional(),
  tag: zTag.optional(),
  memberId: zId.optional(),
  scope: z.enum(SCOPES).default('household'),
  sort: z.enum(['date', 'amount', 'created']).default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

export const createCommentSchema = z.object({
  body: trimmed(1, 2000, 'Comment'),
  mentions: z.array(zId).max(20).default([]),
});

// ---------- budgets ----------
export const saveBudgetSchema = z.object({
  month: zMonth,
  expectedIncomeCents: zNonNegativeCents.default(0),
  items: z
    .array(z.object({ categoryId: zId, amountCents: zNonNegativeCents }))
    .max(200)
    .refine((items) => new Set(items.map((i) => i.categoryId)).size === items.length, {
      message: 'Each category may appear only once',
    }),
});

// ---------- goals ----------
export const createGoalSchema = z.object({
  name: trimmed(1, 60, 'Goal name'),
  targetCents: zPositiveCents,
  targetDate: zISODate.optional().nullable(),
  icon: z.enum(['home', 'education', 'emergency', 'travel', 'car', 'retirement', 'other']).default('other'),
  plannedMonthlyCents: zNonNegativeCents.default(0),
});
// Update schemas are written out explicitly: in Zod 4, `.partial()` keeps `.default()`s, so a
// partial PATCH (e.g. archive) would silently reset defaulted fields such as icon or autopay.
export const updateGoalSchema = z.object({
  name: trimmed(1, 60, 'Goal name').optional(),
  targetCents: zPositiveCents.optional(),
  targetDate: zISODate.optional().nullable(),
  icon: z.enum(['home', 'education', 'emergency', 'travel', 'car', 'retirement', 'other']).optional(),
  plannedMonthlyCents: zNonNegativeCents.optional(),
  archived: z.boolean().optional(),
});
export const goalContributionSchema = z.object({
  amountCents: zSignedCents.refine((v) => v !== 0, 'Amount cannot be zero'),
  date: zISODate,
  note: z.string().trim().max(200).optional(),
});

// ---------- recurring (bills & income) ----------
const recurringBase = z.object({
  kind: z.enum(RECURRING_KINDS),
  label: trimmed(1, 60, 'Label'),
  amountCents: zPositiveCents,
  /** For variable income: the lowest amount you would expect in a bad period. */
  minAmountCents: zNonNegativeCents.optional().nullable(),
  frequency: z.enum(FREQUENCIES),
  nextDate: zISODate,
  endDate: zISODate.optional().nullable(),
  accountId: zId.optional().nullable(),
  categoryId: zId.optional().nullable(),
  autopay: z.boolean().default(false),
});
export const createRecurringSchema = recurringBase
  .refine((v) => !v.endDate || v.endDate >= v.nextDate, { message: 'End date must be after the next date', path: ['endDate'] })
  .refine((v) => v.minAmountCents == null || v.minAmountCents <= v.amountCents, {
    message: 'Minimum cannot exceed the expected amount',
    path: ['minAmountCents'],
  });
export const updateRecurringSchema = z.object({
  kind: z.enum(RECURRING_KINDS).optional(),
  label: trimmed(1, 60, 'Label').optional(),
  amountCents: zPositiveCents.optional(),
  minAmountCents: zNonNegativeCents.optional().nullable(),
  frequency: z.enum(FREQUENCIES).optional(),
  nextDate: zISODate.optional(),
  endDate: zISODate.optional().nullable(),
  accountId: zId.optional().nullable(),
  categoryId: zId.optional().nullable(),
  autopay: z.boolean().optional(),
  active: z.boolean().optional(),
});
export const markPaidSchema = z.object({
  date: zISODate.optional(),
  amountCents: zPositiveCents.optional(),
  accountId: zId.optional(),
});

// ---------- rules ----------
export const ruleConditionsSchema = z
  .object({
    type: z.enum(['expense', 'income']).optional(),
    descriptionContains: z.string().trim().min(1).max(60).optional(),
    merchantContains: z.string().trim().min(1).max(60).optional(),
    tag: zTag.optional(),
    categoryId: zId.optional(),
    accountId: zId.optional(),
    minAmountCents: zNonNegativeCents.optional(),
    maxAmountCents: zNonNegativeCents.optional(),
  })
  .refine((c) => Object.values(c).some((v) => v !== undefined), { message: 'Add at least one condition' });
export const ruleActionsSchema = z
  .object({
    setCategoryId: zId.optional(),
    addTags: z.array(zTag).max(5).optional(),
    allocateToGoal: z.object({ goalId: zId, basisPoints: z.number().int().min(1).max(10_000) }).optional(),
  })
  .refine((a) => a.setCategoryId || (a.addTags && a.addTags.length) || a.allocateToGoal, {
    message: 'Add at least one action',
  });
export const createRuleSchema = z.object({
  name: trimmed(1, 60, 'Rule name'),
  enabled: z.boolean().default(true),
  conditions: ruleConditionsSchema,
  actions: ruleActionsSchema,
});
export const updateRuleSchema = z.object({
  name: trimmed(1, 60, 'Rule name').optional(),
  enabled: z.boolean().optional(),
  conditions: ruleConditionsSchema.optional(),
  actions: ruleActionsSchema.optional(),
});

// ---------- scenarios / forecast ----------
export const adjustmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('income_change'),
    recurringId: zId.nullable().default(null), // null = all income streams
    basisPoints: zBasisPoints,
    startDate: zISODate.optional(),
    endDate: zISODate.optional(),
  }),
  z.object({
    kind: z.literal('expense_change'),
    categoryId: zId.nullable().default(null), // null = all everyday (non-bill) spending
    basisPoints: z.number().int().min(-10_000).max(50_000),
    startDate: zISODate.optional(),
    endDate: zISODate.optional(),
  }),
  z.object({
    kind: z.literal('one_time'),
    label: trimmed(1, 60, 'Label'),
    amountCents: zSignedCents.refine((v) => v !== 0, 'Amount cannot be zero'),
    date: zISODate,
  }),
  z.object({
    kind: z.literal('delay_bill'),
    recurringId: zId,
    days: z.number().int().min(1).max(120),
  }),
  z.object({
    kind: z.literal('new_recurring'),
    label: trimmed(1, 60, 'Label'),
    amountCents: zSignedCents.refine((v) => v !== 0, 'Amount cannot be zero'),
    frequency: z.enum(FREQUENCIES),
    startDate: zISODate,
    endDate: zISODate.optional(),
  }),
]);
export type Adjustment = z.infer<typeof adjustmentSchema>;

export const forecastRequestSchema = z.object({
  horizonMonths: z.union([z.literal(3), z.literal(6), z.literal(12), z.literal(24)]).default(6),
  granularity: z.enum(['week', 'month']).default('month'),
  scope: z.enum(SCOPES).default('household'),
  incomeMode: z.enum(['expected', 'conservative']).default('expected'),
  adjustments: z.array(adjustmentSchema).max(20).default([]),
});
export type ForecastRequest = z.infer<typeof forecastRequestSchema>;

export const saveScenarioSchema = z.object({
  name: trimmed(1, 60, 'Scenario name'),
  description: z.string().trim().max(240).optional().nullable(),
  horizonMonths: forecastRequestSchema.shape.horizonMonths,
  granularity: forecastRequestSchema.shape.granularity,
  incomeMode: forecastRequestSchema.shape.incomeMode,
  adjustments: z.array(adjustmentSchema).max(20),
});

// ---------- notifications ----------
export const notificationPrefsSchema = z.object({
  budgetThresholdPct: z.number().int().min(50).max(100),
  billReminderDays: z.number().int().min(0).max(14),
  forecastDeficit: z.boolean(),
  mentions: z.boolean(),
  comments: z.boolean(),
  goals: z.boolean(),
  ruleActivity: z.boolean(),
  safetyBufferCents: zNonNegativeCents,
});

// ---------- imports ----------
export const csvImportSchema = z
  .object({
    accountId: zId,
    csv: z.string().min(1, 'The file is empty').max(1_000_000, 'CSV must be under 1 MB'),
    mapping: z.object({
      date: z.string().min(1),
      description: z.string().min(1),
      amount: z.string().optional(),
      debit: z.string().optional(),
      credit: z.string().optional(),
      category: z.string().optional(),
    }),
    dateFormat: z.enum(['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY']).default('YYYY-MM-DD'),
    /** Many banks export spending as positive numbers; flip so spending is negative. */
    invertAmounts: z.boolean().default(false),
    skipDuplicates: z.boolean().default(true),
  })
  .refine((v) => v.mapping.amount || v.mapping.debit || v.mapping.credit, {
    message: 'Map an Amount column, or Debit/Credit columns',
    path: ['mapping'],
  });
export type CsvImportRequest = z.infer<typeof csvImportSchema>;
