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

// GIF credit amounts per product (must match backend/functions/src/index.ts)
export const GIF_CREDIT_PACKS: Record<string, { credits: number; label: string }> = {
  token_pack_tier1: { credits: 2, label: 'Starter Pack' },
  token_pack_tier2: { credits: 10, label: 'Popular Pack' },
  token_pack_tier3: { credits: 40, label: 'Pro Pack' },
  token_pack_tier4: { credits: 200, label: 'Power Pack' },
};

// Product IDs - derived from GIF_CREDIT_PACKS so product metadata stays in sync.
export const GIF_PRODUCT_IDS = Object.keys(GIF_CREDIT_PACKS);

export const queryProducts = async (): Promise<Product[]> => {
  if (!isAndroid()) {
    // Return mock products for web development/testing
    return GIF_PRODUCT_IDS.map(id => ({
      productId: id,
      title: GIF_CREDIT_PACKS[id].label,
      description: `${GIF_CREDIT_PACKS[id].credits} GIF credits`,
      price: 'N/A',
      priceAmountMicros: 0,
      priceCurrencyCode: 'USD',
    }));
  }

  try {
    const result = await BillingPlugin.queryProducts({ productIds: GIF_PRODUCT_IDS });
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
