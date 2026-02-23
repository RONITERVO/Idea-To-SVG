import React, { useState, useEffect, useRef } from 'react';
import { X, Coins, ShoppingCart, Loader2 } from 'lucide-react';
import { queryProducts, purchaseProduct, GIF_CREDIT_PACKS, type Product } from '../services/billing';
import { verifyPurchase } from '../services/backendApi';
import { refreshBalance, formatCredits } from '../services/tokenManager';
import { isAndroid } from '../services/platform';
import { getCurrentUser } from '../services/auth';

interface TokenPurchaseProps {
  isOpen: boolean;
  onClose: () => void;
  onPurchaseComplete: () => void;
}

const PRODUCT_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedProducts: Product[] | null = null;
let cachedProductsAt = 0;

const TokenPurchase: React.FC<TokenPurchaseProps> = ({ isOpen, onClose, onPurchaseComplete }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const purchaseCompleteTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadProducts();
      return;
    }
    if (purchaseCompleteTimerRef.current !== null) {
      window.clearTimeout(purchaseCompleteTimerRef.current);
      purchaseCompleteTimerRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (purchaseCompleteTimerRef.current !== null) {
        window.clearTimeout(purchaseCompleteTimerRef.current);
        purchaseCompleteTimerRef.current = null;
      }
    };
  }, []);

  const loadProducts = async () => {
    setIsLoading(true);
    setError(null);

    const now = Date.now();
    if (cachedProducts && now - cachedProductsAt < PRODUCT_CACHE_TTL_MS) {
      setProducts(cachedProducts);
      setIsLoading(false);
      return;
    }

    try {
      const prods = await queryProducts();
      if (prods.length > 0) {
        cachedProducts = prods;
        cachedProductsAt = Date.now();
      } else {
        cachedProducts = null;
        cachedProductsAt = 0;
      }
      setProducts(prods);
    } catch (err: any) {
      cachedProducts = null;
      cachedProductsAt = 0;
      setError('Failed to load products. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePurchase = async (productId: string) => {
    if (!isAndroid()) {
      setError('In-app purchases are only available in the Android app.');
      return;
    }

    setIsPurchasing(productId);
    setError(null);
    setSuccess(null);

    try {
      const user = getCurrentUser();
      if (!user) {
        throw new Error('Please sign in to purchase GIF credits.');
      }

      // Launch native purchase flow
      const result = await purchaseProduct(productId, user.uid);

      // Verify purchase with backend
      const verification = await verifyPurchase(result.purchaseToken, productId);

      // Refresh balance
      await refreshBalance();

      const packInfo = GIF_CREDIT_PACKS[productId];
      if (verification.alreadyCredited) {
        setSuccess('This purchase was already credited to your account.');
      } else {
        const granted = verification.creditsGranted ?? packInfo?.credits ?? 0;
        setSuccess(`Added ${formatCredits(granted)} GIF credits to your balance!`);
      }

      if (purchaseCompleteTimerRef.current !== null) {
        window.clearTimeout(purchaseCompleteTimerRef.current);
      }
      purchaseCompleteTimerRef.current = window.setTimeout(() => {
        purchaseCompleteTimerRef.current = null;
        onPurchaseComplete();
      }, 1500);
    } catch (err: any) {
      const errorCode = err?.code || err?.errorCode;
      const isCancelledCode =
        errorCode === 'USER_CANCELLED' ||
        errorCode === 'BILLING_1' ||
        errorCode === 1;
      const message = String(err?.message || '');
      const isCancelledMessage = message.toLowerCase().includes('cancelled') || message.toLowerCase().includes('canceled');

      if (isCancelledCode || isCancelledMessage) {
        // User cancelled - not an error
        setError(null);
      } else {
        setError(err.message || 'Purchase failed. Please try again.');
      }
    } finally {
      setIsPurchasing(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-background/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-card w-full md:max-w-lg md:sketchy-border rounded-t-3xl md:rounded-none p-6 md:p-8 relative shadow-2xl animate-sketch-in max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-muted/20 hover:bg-muted/50 rounded-full transition-colors text-foreground"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-accent/10 rounded-lg">
            <ShoppingCart className="text-accent" size={28} />
          </div>
          <div>
            <h2 className="font-sketch text-3xl text-foreground">Get GIF Credits</h2>
            <p className="font-hand text-sm text-muted-foreground">Fractional credit settlement with whole-number estimate display</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-accent" size={32} />
            <span className="ml-3 font-hand text-lg text-muted-foreground">Loading products...</span>
          </div>
        ) : (
          <div className="space-y-3">
            {products.map((product) => {
              const packInfo = GIF_CREDIT_PACKS[product.productId];
              const isBuying = isPurchasing === product.productId;

              return (
                <button
                  key={product.productId}
                  onClick={() => handlePurchase(product.productId)}
                  disabled={isPurchasing !== null}
                  className={`w-full p-4 sketchy-border-thin flex items-center gap-4 text-left transition-all
                    ${isBuying ? 'bg-accent/20 scale-[0.98]' : 'hover:bg-accent/10'}
                    ${isPurchasing !== null && !isBuying ? 'opacity-50' : ''}
                  `}
                >
                  <div className="p-2 bg-accent/10 rounded-lg flex-shrink-0">
                    <Coins className="text-accent" size={24} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-sketch text-lg text-foreground">
                      {packInfo?.label || product.title}
                    </h3>
                    <p className="font-hand text-sm text-muted-foreground">
                      {(packInfo?.credits || 0)} GIF credits
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {isBuying ? (
                      <Loader2 className="animate-spin text-accent" size={20} />
                    ) : (
                      <span className="font-sketch text-xl text-accent">
                        {product.price !== 'N/A' ? product.price : '--'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
            <p className="font-hand text-sm text-destructive/90">{error}</p>
          </div>
        )}

        {success && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="font-hand text-sm text-green-700">{success}</p>
          </div>
        )}

        <div className="mt-4 p-3 bg-muted/20 rounded-lg">
          <p className="font-hand text-xs text-muted-foreground">
            Charges are settled with fractional precision from actual token usage. Per-generation previews are shown as whole numbers for readability.
          </p>
        </div>

        {!isAndroid() && (
          <div className="mt-4 p-3 bg-muted/30 rounded-lg">
            <p className="font-hand text-xs text-muted-foreground text-center">
              GIF credit purchases are available in the Android app via Google Play.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TokenPurchase;
