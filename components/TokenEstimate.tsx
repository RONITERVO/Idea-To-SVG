import React from 'react';
import { Calculator, AlertTriangle } from 'lucide-react';
import * as tokenManager from '../services/tokenManager';
import type { TokenEstimateResult } from '../services/gemini';

interface TokenEstimateProps {
  estimate: TokenEstimateResult | null;
  balance: number;
  isTokenMode: boolean;
  isLoading: boolean;
  autoRefineEnabled: boolean;
  onAutoRefineChange: (enabled: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onBuyTokens: () => void;
}

const TokenEstimate: React.FC<TokenEstimateProps> = ({
  estimate,
  balance,
  isTokenMode,
  isLoading,
  autoRefineEnabled,
  onAutoRefineChange,
  onConfirm,
  onCancel,
  onBuyTokens,
}) => {
  if (!estimate && !isLoading) return null;
  const EPSILON = tokenManager.EPSILON;
  const { formatTokens, formatCredits } = tokenManager;

  const fractionalEstimate = Math.max(0, estimate?.estimatedGifCredits || 0);
  const rawEstimatedCredits = Math.max(0, estimate?.estimatedRawGifCredits || fractionalEstimate);
  const displayEstimate = Math.max(
    1,
    Math.ceil(estimate?.estimatedDisplayGifCredits ?? fractionalEstimate)
  );
  const roundedUpByCredits = Math.max(0, displayEstimate - fractionalEstimate);
  const canAfford = !isTokenMode || tokenManager.canAfford(displayEstimate, balance + EPSILON);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="token-estimate-title"
    >
      <div className="bg-card sketchy-border w-full max-w-md p-6 relative shadow-2xl animate-sketch-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-accent/10 rounded-lg">
            <Calculator className="text-accent" size={24} />
          </div>
          <h2 id="token-estimate-title" className="font-sketch text-2xl text-foreground">Generation Cost</h2>
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
                <span className="text-muted-foreground">Input tokens (approx.)</span>
                <span className="text-foreground">{formatTokens(estimate.estimatedInputTokens)}</span>
              </div>
              <div className="flex justify-between font-hand text-base">
                <span className="text-muted-foreground">Output tokens (approx.)</span>
                <span className="text-foreground">{formatTokens(estimate.estimatedOutputTokens)}</span>
              </div>
              <div className="flex justify-between font-hand text-base">
                <span className="text-muted-foreground">Estimated GIF credits (shown as whole number)</span>
                <span className="text-foreground">{formatCredits(displayEstimate, { whole: true })}</span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between font-sketch text-xl">
                <span>Total tokens per cycle</span>
                <span className="text-accent">{formatTokens(estimate.estimatedTotalTokens)}</span>
              </div>
            </div>

            {isTokenMode && (
              <div className="bg-muted/20 rounded-lg p-3 space-y-1.5">
                <p className="font-hand text-sm text-foreground/90">
                  Billing policy: charges are settled with fractional precision and shown as whole numbers in per-generation previews.
                </p>
                <p className="font-hand text-xs text-muted-foreground">
                  Cost-only estimate: {rawEstimatedCredits.toFixed(2)} credits. Billed estimate: {fractionalEstimate.toFixed(2)}. Displayed estimate: {formatCredits(displayEstimate, { whole: true })}.
                  {roundedUpByCredits > 0 ? ` Rounded up by ${roundedUpByCredits.toFixed(2)}.` : ''}
                </p>
                <p className="font-hand text-xs text-muted-foreground">
                  A provisional reserve is taken before billed phases. Final settlement uses actual input/output/thinking token usage from the model response.
                </p>
              </div>
            )}

            <p className="font-hand text-sm text-muted-foreground">
              You will generate one GIF result first. Auto refinement is optional and can continue generating more results.
            </p>

            <label className="flex items-center gap-2 p-3 bg-muted/20 rounded-lg font-hand text-sm text-foreground">
              <input
                type="checkbox"
                checked={autoRefineEnabled}
                onChange={(e) => onAutoRefineChange(e.target.checked)}
              />
              Enable auto refinement loop (off by default)
            </label>

            {isTokenMode && (
              <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
                <div className="flex justify-between font-hand text-base">
                  <span>Your GIF credits</span>
                  <span className={`font-sketch text-lg ${canAfford ? 'text-foreground' : 'text-destructive'}`}>
                    {formatCredits(balance)}
                  </span>
                </div>
                {!canAfford && (
                  <div className="flex items-center gap-2 mt-2 text-destructive">
                    <AlertTriangle size={14} />
                    <span className="font-hand text-sm">Insufficient GIF credits for this run (final settlement may exceed the shown estimate)</span>
                  </div>
                )}
              </div>
            )}

            {!isTokenMode && (
              <p className="font-hand text-xs text-muted-foreground text-center">
                Using your API key - no GIF credits needed.
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
                Buy GIF Credits
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
