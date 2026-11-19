import type { CategoryGroup } from '@familypulse/shared';

/**
 * Starter categories, organised in the prototype's Living / Entertainment / Unexpected groups.
 * Colours derive from the prototype's spending donut (orange = living, violet = entertainment,
 * red = unexpected) and the brand forest green for income.
 */
export const DEFAULT_CATEGORIES: { name: string; group: CategoryGroup; color: string }[] = [
  { name: 'Groceries', group: 'living', color: '#E8780C' },
  { name: 'Housing', group: 'living', color: '#B85A0A' },
  { name: 'Utilities', group: 'living', color: '#F29B4B' },
  { name: 'Transportation', group: 'living', color: '#C9700F' },
  { name: 'Insurance', group: 'living', color: '#DDA06A' },
  { name: 'Health', group: 'living', color: '#A0521A' },
  { name: 'Childcare & education', group: 'living', color: '#F4B47C' },
  { name: 'Clothing', group: 'living', color: '#D48A3C' },
  { name: 'Dining out', group: 'entertainment', color: '#8E1E9E' },
  { name: 'Entertainment', group: 'entertainment', color: '#A955B6' },
  { name: 'Subscriptions', group: 'entertainment', color: '#6C2A8C' },
  { name: 'Travel', group: 'entertainment', color: '#C28ACC' },
  { name: 'Repairs', group: 'unexpected', color: '#D2381F' },
  { name: 'Medical', group: 'unexpected', color: '#E2665A' },
  { name: 'Fees & charges', group: 'unexpected', color: '#A92A18' },
  { name: 'Miscellaneous', group: 'unexpected', color: '#EB9184' },
  { name: 'Salary', group: 'income', color: '#0C3E28' },
  { name: 'Freelance', group: 'income', color: '#1F7A4D' },
  { name: 'Investment income', group: 'income', color: '#3C9D6A' },
  { name: 'Rental income', group: 'income', color: '#6DBE8F' },
  { name: 'Other income', group: 'income', color: '#2E5E47' },
];
