export const ROLES = ['owner', 'admin', 'contributor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Full control, including deleting the household and transferring ownership.',
  admin: 'Manages members, accounts, budgets, goals, bills and rules. Can edit any shared entry.',
  contributor: 'Logs and edits shared entries, optionally limited to specific categories. Can comment.',
  viewer: 'Read-only access to shared reports and the ledger. Can comment and ask questions.',
};

/** Category groups mirror the prototype's "Smart budget" structure. */
export const CATEGORY_GROUPS = ['living', 'entertainment', 'unexpected', 'income'] as const;
export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];
export const CATEGORY_GROUP_LABELS: Record<CategoryGroup, string> = {
  living: 'Living',
  entertainment: 'Entertainment',
  unexpected: 'Unexpected',
  income: 'Income',
};
export const EXPENSE_GROUPS: CategoryGroup[] = ['living', 'entertainment', 'unexpected'];

export const ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'credit_card', 'loan', 'investment', 'other_asset'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  cash: 'Cash',
  credit_card: 'Credit card',
  loan: 'Loan',
  investment: 'Investment',
  other_asset: 'Other asset',
};
export const LIABILITY_TYPES: AccountType[] = ['credit_card', 'loan'];
/** Accounts whose balance is spendable cash for forecasting. */
export const LIQUID_TYPES: AccountType[] = ['checking', 'savings', 'cash'];

export const ACCOUNT_VISIBILITY = ['shared', 'private'] as const;
export type AccountVisibility = (typeof ACCOUNT_VISIBILITY)[number];

export const TRANSACTION_TYPES = ['expense', 'income', 'transfer', 'adjustment'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'yearly', 'once'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  once: 'One time',
};

export const RECURRING_KINDS = ['income', 'bill'] as const;
export type RecurringKind = (typeof RECURRING_KINDS)[number];

export const SCOPES = ['household', 'personal'] as const;
export type Scope = (typeof SCOPES)[number];

export const NOTIFICATION_TYPES = [
  'budget_threshold',
  'budget_exceeded',
  'bill_due',
  'forecast_deficit',
  'goal_reached',
  'goal_milestone',
  'mention',
  'comment',
  'member_joined',
  'role_changed',
  'rule_applied',
  'system',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const SUPPORTED_CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'JPY', 'SGD', 'MXN', 'BRL', 'INR', 'CNY', 'KRW'] as const;

export const DEFAULT_NOTIFICATION_PREFS = {
  budgetThresholdPct: 80,
  billReminderDays: 3,
  forecastDeficit: true,
  mentions: true,
  comments: true,
  goals: true,
  ruleActivity: false,
  /** Minimum liquid balance before the forecast warns (cents). */
  safetyBufferCents: 0,
} as const;
export type NotificationPrefs = {
  budgetThresholdPct: number;
  billReminderDays: number;
  forecastDeficit: boolean;
  mentions: boolean;
  comments: boolean;
  goals: boolean;
  ruleActivity: boolean;
  safetyBufferCents: number;
};
