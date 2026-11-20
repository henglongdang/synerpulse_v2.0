import type {
  AccountType,
  AccountVisibility,
  CategoryGroup,
  Frequency,
  NotificationPrefs,
  NotificationType,
  RecurringKind,
  Role,
  TransactionType,
} from './constants';
import type { Adjustment } from './schemas';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, string[]>; current?: unknown };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface SessionDTO {
  id: string;
  current: boolean;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface HouseholdSummaryDTO {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  role: Role;
  isSample: boolean;
  memberCount: number;
  onboardedAt: string | null;
}

export interface MemberDTO {
  userId: string;
  name: string;
  email: string;
  role: Role;
  categoryScope: string[];
  joinedAt: string;
}

export interface InviteDTO {
  id: string;
  email: string | null;
  role: Role;
  categoryScope: string[];
  expiresAt: string;
  createdBy: string;
  /** Only returned once, at creation time. */
  url?: string;
}

export interface AccountDTO {
  id: string;
  name: string;
  type: AccountType;
  visibility: AccountVisibility;
  ownerUserId: string;
  ownerName: string;
  institution: string | null;
  last4: string | null;
  openingBalanceCents: number;
  openingDate: string;
  balanceCents: number;
  creditLimitCents: number | null;
  archived: boolean;
  provider: 'manual' | 'csv';
}

export interface CategoryDTO {
  id: string;
  name: string;
  group: CategoryGroup;
  color: string;
  archived: boolean;
}

export type TransactionSource = 'manual' | 'import' | 'recurring' | 'adjustment' | 'transfer';

export interface TransactionDTO {
  id: string;
  accountId: string;
  accountName: string;
  accountVisibility: AccountVisibility;
  type: TransactionType;
  /** Signed from the account's perspective: money out is negative. */
  amountCents: number;
  date: string;
  description: string;
  merchant: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryGroup: CategoryGroup | null;
  notes: string | null;
  tags: string[];
  transferGroupId: string | null;
  source: TransactionSource;
  version: number;
  createdBy: { id: string; name: string } | null;
  updatedBy: { id: string; name: string } | null;
  commentCount: number;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export interface RevisionDTO {
  version: number;
  action: 'created' | 'updated' | 'reverted' | 'deleted' | 'restored';
  changes: { field: string; from: unknown; to: unknown }[];
  editor: { id: string; name: string } | null;
  createdAt: string;
}

export interface CommentDTO {
  id: string;
  body: string;
  author: { id: string; name: string } | null;
  mentions: { id: string; name: string }[];
  createdAt: string;
}

export interface AttachmentDTO {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface BudgetLineDTO {
  categoryId: string;
  categoryName: string;
  group: CategoryGroup;
  color: string;
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
  /** spent / budget in basis points (0 when no budget). */
  usedBp: number;
  /** Paid by a scheduled bill — reaching 100% is expected, so only overspending is flagged. */
  billCovered: boolean;
  status: 'ok' | 'warning' | 'over' | 'unbudgeted';
}

export interface BudgetGroupDTO {
  group: CategoryGroup;
  budgetCents: number;
  spentCents: number;
  usedBp: number;
  lines: BudgetLineDTO[];
}

export interface BudgetMonthDTO {
  month: string;
  /** Month whose plan is in effect (plans carry forward), or null if none yet. */
  planMonth: string | null;
  expectedIncomeCents: number;
  actualIncomeCents: number;
  totalBudgetCents: number;
  totalSpentCents: number;
  /** Fraction of the month elapsed (bp) — lets the UI show a "today" pace marker. */
  monthElapsedBp: number;
  groups: BudgetGroupDTO[];
}

export interface GoalDTO {
  id: string;
  name: string;
  icon: string;
  targetCents: number;
  savedCents: number;
  targetDate: string | null;
  plannedMonthlyCents: number;
  progressBp: number;
  /** Monthly amount needed from now to hit the target by targetDate (null if no date). */
  requiredMonthlyCents: number | null;
  projectedCompletion: string | null;
  onTrack: boolean | null;
  archived: boolean;
}

export interface RecurringDTO {
  id: string;
  kind: RecurringKind;
  label: string;
  amountCents: number;
  minAmountCents: number | null;
  frequency: Frequency;
  nextDate: string;
  endDate: string | null;
  accountId: string | null;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  autopay: boolean;
  active: boolean;
  monthlyEquivalentCents: number;
}

export interface UpcomingBillDTO {
  recurringId: string;
  label: string;
  amountCents: number;
  dueDate: string;
  daysUntil: number;
  autopay: boolean;
  categoryName: string | null;
}

export interface NetWorthPointDTO {
  date: string;
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
}

export interface PeriodTotalsDTO {
  incomeCents: number;
  spendCents: number;
  netCents: number;
  savingsContributionCents: number;
}

export interface SmartTipDTO {
  id: string;
  kind: 'near_limit' | 'over_limit' | 'above_usual' | 'recurring_charge' | 'deficit_ahead' | 'goal_behind' | 'uncategorized';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  /** How the tip was derived — shown on demand for transparency. */
  basis: string;
  link?: string;
}

export interface DashboardDTO {
  scope: 'household' | 'personal';
  currency: string;
  asOf: string;
  netWorth: { currentCents: number; assetsCents: number; liabilitiesCents: number; change30dCents: number };
  history: NetWorthPointDTO[];
  totals: {
    income: { last7: number; prev7: number; month: number };
    spend: { last7: number; prev7: number; month: number };
    savingsCents: number;
    loansCents: number;
    investmentsCents: number;
  };
  accountGroups: { type: AccountType; label: string; totalCents: number; accounts: AccountDTO[] }[];
  budget: { month: string; totalBudgetCents: number; totalSpentCents: number; usedBp: number; monthElapsedBp: number; overCount: number };
  upcomingBills: UpcomingBillDTO[];
  goals: GoalDTO[];
  forecast: { lowestBalanceCents: number; lowestBalanceDate: string; firstDeficitDate: string | null; endBalanceCents: number; horizonMonths: number };
  tips: SmartTipDTO[];
  recentActivity: ActivityDTO[];
  creditCards: { totalOwedCents: number; totalLimitCents: number; utilizationBp: number | null; spend7Cents: number; txnCount7: number };
}

export interface ForecastPeriodDTO {
  start: string;
  end: string;
  label: string;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  endBalanceCents: number;
  minBalanceCents: number;
}

export interface ForecastEventDTO {
  date: string;
  label: string;
  amountCents: number;
  kind: 'income' | 'bill' | 'everyday' | 'goal' | 'one_time' | 'scenario';
  source: 'baseline' | 'scenario';
}

export interface ForecastSeriesDTO {
  periods: ForecastPeriodDTO[];
  startBalanceCents: number;
  endBalanceCents: number;
  lowestBalanceCents: number;
  lowestBalanceDate: string;
  firstDeficitDate: string | null;
  firstBelowBufferDate: string | null;
  totalInflowCents: number;
  totalOutflowCents: number;
}

export interface ForecastResultDTO {
  asOf: string;
  horizonMonths: number;
  granularity: 'week' | 'month';
  incomeMode: 'expected' | 'conservative';
  safetyBufferCents: number;
  baseline: ForecastSeriesDTO;
  scenario: ForecastSeriesDTO | null;
  /** Transparent derivation of the baseline: what the engine assumed. */
  assumptions: {
    startingBalanceCents: number;
    liquidAccounts: { id: string; name: string; balanceCents: number }[];
    incomeStreams: { id: string; label: string; amountCents: number; usedAmountCents: number; frequency: Frequency; nextDate: string }[];
    bills: { id: string; label: string; amountCents: number; frequency: Frequency; nextDate: string }[];
    everydaySpendMonthlyCents: number;
    everydaySpendBasis: string;
    goalContributionsMonthlyCents: number;
  };
  upcomingEvents: ForecastEventDTO[];
}

export interface ScenarioDTO {
  id: string;
  name: string;
  description: string | null;
  horizonMonths: 3 | 6 | 12 | 24;
  granularity: 'week' | 'month';
  incomeMode: 'expected' | 'conservative';
  adjustments: Adjustment[];
  createdBy: { id: string; name: string } | null;
  updatedAt: string;
}

export interface RuleDTO {
  id: string;
  name: string;
  enabled: boolean;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  timesApplied: number;
  lastAppliedAt: string | null;
  createdAt: string;
}

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  householdId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ActivityDTO {
  id: string;
  actor: { id: string; name: string } | null;
  entityType: string;
  entityId: string | null;
  action: string;
  summary: string;
  createdAt: string;
}

export interface MeDTO {
  user: UserDTO;
  households: HouseholdSummaryDTO[];
  notificationPrefs: NotificationPrefs;
  unreadNotifications: number;
}

export interface ImportPreviewRowDTO {
  line: number;
  date: string | null;
  description: string;
  amountCents: number | null;
  category: string | null;
  duplicate: boolean;
  error: string | null;
}

export interface ImportResultDTO {
  rows: ImportPreviewRowDTO[];
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  importedCount?: number;
}
