import { getBalance as fetchBalance } from "./backendApi";

type BalanceListener = (balance: number) => void;

let cachedBalance: number | null = null;
let listeners: BalanceListener[] = [];
const CREDIT_DECIMALS = 3;
const CREDIT_FACTOR = 10 ** CREDIT_DECIMALS;
export const EPSILON = 1e-9;
export const normalizeCredits = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, value) * CREDIT_FACTOR) / CREDIT_FACTOR;
};

export const refreshBalance = async (): Promise<number> => {
  const balance = await fetchBalance();
  cachedBalance = normalizeCredits(balance);
  notifyListeners();
  return cachedBalance;
};

export const getLocalBalance = (): number | null => cachedBalance;

export const updateLocalBalance = (newBalance: number): void => {
  cachedBalance = normalizeCredits(newBalance);
  notifyListeners();
};

export const canAfford = (estimatedCost: number, balanceOverride?: number): boolean => {
  const availableBalance = balanceOverride ?? cachedBalance;
  return availableBalance !== null && normalizeCredits(availableBalance) + EPSILON >= normalizeCredits(estimatedCost);
};

export const subscribeToBalance = (listener: BalanceListener): (() => void) => {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
};

const notifyListeners = () => {
  if (cachedBalance === null) return;
  listeners.forEach((l) => l(cachedBalance));
};

// Format token count for display
export const formatTokens = (count: number): string => {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    if (Math.round(count / 1_000) === 1_000) {
      return `${(count / 1_000_000).toFixed(1)}M`;
    }
    return `${(count / 1_000).toFixed(0)}K`;
  }
  return count.toString();
};

export const formatCredits = (
  count: number,
  options?: {
    whole?: boolean;
    decimals?: number;
  }
): string => {
  const normalized = normalizeCredits(count);
  if (options?.whole) {
    return Math.max(0, Math.ceil(normalized)).toLocaleString('en-US');
  }

  const decimals = Math.min(4, Math.max(0, Math.floor(options?.decimals ?? 2)));
  return normalized.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
};
