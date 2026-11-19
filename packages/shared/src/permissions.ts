import type { Role } from './constants';

/**
 * Single source of truth for what each household role may do.
 * The API enforces these server-side on every request; the web app uses the same
 * table only to hide controls a user cannot use (never as a security boundary).
 */
export const CAPABILITIES = [
  'household.view',
  'household.update',
  'household.delete',
  'household.transferOwnership',
  'members.manage',
  'accounts.manage',
  'categories.manage',
  'transactions.create',
  'transactions.editOwn',
  'transactions.editAny',
  'comments.create',
  'budgets.manage',
  'goals.manage',
  'goals.contribute',
  'recurring.manage',
  'recurring.markPaid',
  'rules.manage',
  'scenarios.manage',
  'imports.run',
  'activity.view',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const VIEWER: Capability[] = ['household.view', 'comments.create', 'activity.view'];
const CONTRIBUTOR: Capability[] = [
  ...VIEWER,
  'transactions.create',
  'transactions.editOwn',
  'transactions.editAny', // still subject to category scope (see canEditTransaction)
  'goals.contribute',
  'recurring.markPaid',
  'scenarios.manage',
  'imports.run',
];
const ADMIN: Capability[] = [
  ...CONTRIBUTOR,
  'household.update',
  'members.manage',
  'accounts.manage',
  'categories.manage',
  'budgets.manage',
  'goals.manage',
  'recurring.manage',
  'rules.manage',
];
const OWNER: Capability[] = [...ADMIN, 'household.delete', 'household.transferOwnership'];

const MATRIX: Record<Role, ReadonlySet<Capability>> = {
  viewer: new Set(VIEWER),
  contributor: new Set(CONTRIBUTOR),
  admin: new Set(ADMIN),
  owner: new Set(OWNER),
};

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role].has(capability);
}

export const ROLE_RANK: Record<Role, number> = { viewer: 0, contributor: 1, admin: 2, owner: 3 };

/** An actor may only assign/modify roles strictly below their own (owner may assign admin). */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (!can(actor, 'members.manage')) return false;
  if (target === 'owner') return false; // ownership moves only via transfer
  return ROLE_RANK[target] < ROLE_RANK[actor] || (actor === 'owner' && target === 'admin');
}

export function canManageMember(actor: Role, memberRole: Role): boolean {
  if (!can(actor, 'members.manage')) return false;
  if (memberRole === 'owner') return false;
  return actor === 'owner' || ROLE_RANK[memberRole] < ROLE_RANK[actor];
}

/**
 * Contributors may have their edit rights limited to a set of categories
 * (paper §2.6: "edit access limited to grocery and utility categories").
 * An empty/undefined scope means unrestricted.
 */
export function categoryAllowed(role: Role, scope: readonly string[] | null | undefined, categoryId: string | null): boolean {
  if (role === 'owner' || role === 'admin') return true;
  if (!scope || scope.length === 0) return true;
  if (!categoryId) return false; // scoped contributors must categorise into an allowed category
  return scope.includes(categoryId);
}
