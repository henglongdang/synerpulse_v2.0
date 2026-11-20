import {
  Banknote,
  Briefcase,
  Building2,
  Car,
  CircleDollarSign,
  Coins,
  CreditCard,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  Laptop,
  LifeBuoy,
  Palmtree,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  Shield,
  Shirt,
  ShoppingCart,
  Stethoscope,
  Target,
  Ticket,
  TrendingUp,
  Utensils,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { AccountType } from '@synerpulse/shared/client';

const BY_NAME: Record<string, LucideIcon> = {
  groceries: ShoppingCart,
  housing: Home,
  utilities: Zap,
  transportation: Car,
  insurance: Shield,
  health: HeartPulse,
  'childcare & education': GraduationCap,
  clothing: Shirt,
  'dining out': Utensils,
  entertainment: Ticket,
  subscriptions: Repeat,
  travel: Plane,
  repairs: Wrench,
  medical: Stethoscope,
  'fees & charges': Receipt,
  miscellaneous: Coins,
  salary: Briefcase,
  freelance: Laptop,
  'investment income': TrendingUp,
  'rental income': Building2,
  'other income': CircleDollarSign,
};

export function CategoryIcon({ name, size = 18 }: { name: string | null | undefined; size?: number }) {
  const Icon = (name && BY_NAME[name.toLowerCase()]) || Receipt;
  return <Icon size={size} aria-hidden />;
}

const ACCOUNT_ICONS: Record<AccountType, LucideIcon> = {
  checking: Wallet,
  savings: PiggyBank,
  cash: Banknote,
  credit_card: CreditCard,
  loan: Landmark,
  investment: TrendingUp,
  other_asset: Coins,
};
export function AccountIcon({ type, size = 18 }: { type: AccountType; size?: number }) {
  const Icon = ACCOUNT_ICONS[type];
  return <Icon size={size} aria-hidden />;
}

const GOAL_ICONS: Record<string, LucideIcon> = {
  home: Home,
  education: GraduationCap,
  emergency: LifeBuoy,
  travel: Palmtree,
  car: Car,
  retirement: PiggyBank,
  other: Target,
};
export function GoalIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  const Icon = GOAL_ICONS[icon] ?? Target;
  return <Icon size={size} aria-hidden />;
}
