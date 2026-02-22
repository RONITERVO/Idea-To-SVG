import { registerPlugin } from '@capacitor/core';
import { isAndroid } from './platform';

export interface Product {
  productId: string;
  title: string;
  description: string;
  price: string; // formatted price string from Play Store
  priceAmountMicros: number;
  priceCurrencyCode: string;
}

export interface PurchaseResult {
  purchaseToken: string;
  productId: string;
  orderId: string;
}

interface BillingPluginInterface {
  queryProducts(options: { productIds: string[] }): Promise<{ products: Product[] }>;
  purchaseProduct(options: { productId: string; obfuscatedAccountId?: string }): Promise<PurchaseResult>;
  getPendingPurchases(): Promise<{ purchases: PurchaseResult[] }>;
}

// Register the native plugin - will be available on Android, no-op on web
const BillingPlugin = registerPlugin<BillingPluginInterface>('BillingPlugin');

// Product IDs - must match Play Console configuration
export const TOKEN_PRODUCT_IDS = [
  'token_pack_tier1',
  'token_pack_tier2',
  'token_pack_tier3',
  'token_pack_tier4',
];

// Token amounts per product (must match backend/functions/src/index.ts)
export const TOKEN_AMOUNTS: Record<string, { tokens: number; label: string }> = {
  token_pack_tier1: { tokens: 100_000, label: 'Starter Pack' },
  token_pack_tier2: { tokens: 500_000, label: 'Popular Pack' },
  token_pack_tier3: { tokens: 2_000_000, label: 'Pro Pack' },
  token_pack_tier4: { tokens: 10_000_000, label: 'Power Pack' },
};

export const queryProducts = async (): Promise<Product[]> => {
  if (!isAndroid()) {
    // Return mock products for web development/testing
    return TOKEN_PRODUCT_IDS.map(id => ({
      productId: id,
      title: TOKEN_AMOUNTS[id].label,
      description: `${(TOKEN_AMOUNTS[id].tokens / 1000).toFixed(0)}K tokens`,
      price: 'N/A',
      priceAmountMicros: 0,
      priceCurrencyCode: 'USD',
    }));
  }

  try {
    const result = await BillingPlugin.queryProducts({ productIds: TOKEN_PRODUCT_IDS });
    return result.products;
  } catch (error) {
    console.error('Failed to query products:', error);
    return [];
  }
};

export const purchaseProduct = async (
  productId: string,
  obfuscatedAccountId?: string
): Promise<PurchaseResult> => {
  if (!isAndroid()) {
    throw new Error('In-app purchases are only available on Android');
  }
  return BillingPlugin.purchaseProduct({
    productId,
    ...(obfuscatedAccountId ? { obfuscatedAccountId } : {}),
  });
};

export const getPendingPurchases = async (): Promise<PurchaseResult[]> => {
  if (!isAndroid()) return [];
  try {
    const result = await BillingPlugin.getPendingPurchases();
    return result.purchases;
  } catch {
    return [];
  }
};
