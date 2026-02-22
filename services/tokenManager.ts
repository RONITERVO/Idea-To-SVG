import { getBalance as fetchBalance } from "./backendApi";

type BalanceListener = (balance: number) => void;

let cachedBalance: number | null = null;
let listeners: BalanceListener[] = [];

export const refreshBalance = async (): Promise<number> => {
  const balance = await fetchBalance();
  cachedBalance = balance;
  notifyListeners();
  return balance;
};

export const getLocalBalance = (): number | null => cachedBalance;

export const updateLocalBalance = (newBalance: number): void => {
  cachedBalance = newBalance;
  notifyListeners();
};

export const canAfford = (estimatedCost: number): boolean => {
  return cachedBalance !== null && cachedBalance >= estimatedCost;
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
