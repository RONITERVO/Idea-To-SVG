import React from 'react';
import { Calculator, AlertTriangle } from 'lucide-react';
import { formatTokens } from '../services/tokenManager';
import type { TokenEstimateResult } from '../services/gemini';

interface TokenEstimateProps {
  estimate: TokenEstimateResult | null;
  balance: number;
  isTokenMode: boolean;
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onBuyTokens: () => void;
}

const TokenEstimate: React.FC<TokenEstimateProps> = ({
  estimate,
  balance,
  isTokenMode,
  isLoading,
  onConfirm,
  onCancel,
  onBuyTokens,
}) => {
  if (!estimate && !isLoading) return null;

  const canAfford = !isTokenMode || balance >= (estimate?.estimatedTotal || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-card sketchy-border w-full max-w-md p-6 relative shadow-2xl animate-sketch-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-accent/10 rounded-lg">
            <Calculator className="text-accent" size={24} />
          </div>
          <h2 className="font-sketch text-2xl text-foreground">Token Estimate</h2>
        </div>

        {isLoading ? (
          <div className="text-center py-6">
            <p className="font-hand text-lg text-muted-foreground animate-pulse">
              Estimating cost...
            </p>
          </div>
        ) : estimate ? (
          <div className="space-y-3">
            <div className="bg-muted/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between font-hand text-base">
                <span className="text-muted-foreground">Input tokens (est.)</span>
                <span className="text-foreground">{formatTokens(estimate.estimatedInputTokens)}</span>
              </div>
              <div className="flex justify-between font-hand text-base">
                <span className="text-muted-foreground">Output tokens (est.)</span>
                <span className="text-foreground">{formatTokens(estimate.estimatedOutputTokens)}</span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between font-sketch text-xl">
                <span>Total per cycle</span>
                <span className="text-accent">{formatTokens(estimate.estimatedTotal)}</span>
              </div>
            </div>

            <p className="font-hand text-sm text-muted-foreground">
              Each refinement iteration will use a similar amount. The loop runs continuously until you stop it.
            </p>

            {isTokenMode && (
              <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
                <div className="flex justify-between font-hand text-base">
                  <span>Your balance</span>
                  <span className={`font-sketch text-lg ${canAfford ? 'text-foreground' : 'text-destructive'}`}>
                    {formatTokens(balance)}
                  </span>
                </div>
                {!canAfford && (
                  <div className="flex items-center gap-2 mt-2 text-destructive">
                    <AlertTriangle size={14} />
                    <span className="font-hand text-sm">Insufficient tokens</span>
                  </div>
                )}
              </div>
            )}

            {!isTokenMode && (
              <p className="font-hand text-xs text-muted-foreground text-center">
                Using your API key - no token balance needed.
              </p>
            )}
          </div>
        ) : null}

        <div className="flex gap-3 mt-5">
          {isTokenMode && !canAfford ? (
            <>
              <button
                onClick={onBuyTokens}
                className="flex-1 py-2.5 sketchy-border-thin font-sketch text-lg bg-accent text-white hover:bg-accent/90 transition-all"
              >
                Buy Tokens
              </button>
              <button
                onClick={onCancel}
                className="px-4 py-2.5 sketchy-border-thin font-hand text-base text-muted-foreground hover:text-foreground transition-all"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onConfirm}
                disabled={isLoading}
                className="flex-1 py-2.5 sketchy-border-thin font-sketch text-lg bg-accent text-white hover:bg-accent/90 disabled:bg-muted disabled:text-muted-foreground transition-all"
              >
                {isLoading ? 'Estimating...' : 'Start Generating'}
              </button>
              <button
                onClick={onCancel}
                className="px-4 py-2.5 sketchy-border-thin font-hand text-base text-muted-foreground hover:text-foreground transition-all"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TokenEstimate;
