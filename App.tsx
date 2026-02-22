import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AppPhase, GenerationState, SVGVersion } from './types';
import * as db from './services/db';
import * as gemini from './services/gemini';
import { loadApiKey, initApiKey, ApiKeyError } from './services/apiKeyStorage';
import { useTokenMode as checkTokenMode } from './services/platform';
import {
  onAuthStateChanged,
  getCurrentUser,
  signOut,
  completePendingRedirectSignIn,
} from './services/auth';
import { refreshBalance, subscribeToBalance } from './services/tokenManager';
import { getPendingPurchases } from './services/billing';
import { verifyPurchase, deleteMyAccount } from './services/backendApi';
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL } from './services/appConfig';
import { sanitizeSvg } from './services/svgSanitizer';
import { SVGCanvasHandle } from './components/SVGCanvas';
import type { TokenEstimateResult } from './services/gemini';

import Header from './components/Header';
import ActiveStage from './components/ActiveStage';
import Gallery from './components/Gallery';
import Modal from './components/Modal';
import ManualEntry from './components/ManualEntry';
import SketchSvgFilters from './components/SketchSvgFilters';
import ApiKeyModal from './components/ApiKeyModal';
import TokenEstimate from './components/TokenEstimate';
import TokenPurchase from './components/TokenPurchase';
import WelcomeScreen from './components/WelcomeScreen';
import AccountModal from './components/AccountModal';

const App: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<GenerationState>({
    phase: AppPhase.IDLE,
    currentIteration: 0,
    lastCritique: null,
    lastThoughts: [],
    plan: null,
    error: null,
  });

  const [versions, setVersions] = useState<SVGVersion[]>([]);
  const [currentSVG, setCurrentSVG] = useState<string>('');
  const [viewingVersion, setViewingVersion] = useState<SVGVersion | null>(null);

  // API Key State
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);

  // Token Mode State
  const [isTokenMode, setIsTokenMode] = useState<boolean>(false);
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [showWelcome, setShowWelcome] = useState<boolean>(false);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState<boolean>(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState<boolean>(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState<boolean>(false);

  // Token Estimation State
  const [tokenEstimate, setTokenEstimate] = useState<TokenEstimateResult | null>(null);
  const [isEstimating, setIsEstimating] = useState<boolean>(false);
  const [showEstimate, setShowEstimate] = useState<boolean>(false);

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Refs for Loop Control (to avoid stale closures in setTimeout)
  const isLoopingRef = useRef(false);
  const canvasRef = useRef<SVGCanvasHandle>(null);
  const latestSVGRef = useRef<string>('');
  const promptRef = useRef<string>('');
  const currentVersionIdRef = useRef<string>('');
  const iterationRef = useRef(0);
  const phaseRef = useRef<AppPhase>(AppPhase.IDLE);
  const pendingRecoveryForUidRef = useRef<string | null>(null);

  const reconcilePendingPurchases = useCallback(async (uid: string) => {
    if (pendingRecoveryForUidRef.current === uid) return;
    pendingRecoveryForUidRef.current = uid;

    try {
      const pending = await getPendingPurchases();
      if (pending.length === 0) return;

      for (const purchase of pending) {
        try {
          await verifyPurchase(purchase.purchaseToken, purchase.productId);
        } catch (error) {
          console.error('Pending purchase reconciliation failed for one item:', error);
        }
      }

      await refreshBalance().then(setTokenBalance);
    } catch (error) {
      console.error('Failed to reconcile pending purchases:', error);
    }
  }, []);

  useEffect(() => {
    const initialize = async () => {
      try {
        const saved = await db.getAllVersions();
        setVersions(saved);
      } catch (e) {
        console.error("Failed to load history", e);
      }

      // Completes Google redirect sign-in flows on Android/web if one is pending.
      const redirectUser = await completePendingRedirectSignIn().catch((e) => {
        console.error('Redirect sign-in completion failed:', e);
        return null;
      });

      // Initialize API key from SecureStorage (async on native)
      await initApiKey();

      // Now loadApiKey() returns the cached key
      const apiKey = loadApiKey();
      setHasApiKey(!!apiKey);
      const tokenMode = checkTokenMode();
      setIsTokenMode(tokenMode);
      const currentUser = redirectUser || getCurrentUser();

      if (!apiKey && !tokenMode) {
        setIsApiKeyModalOpen(true);
      } else if (!apiKey && tokenMode) {
        setShowWelcome(!currentUser);
      }
    };

    initialize();

    // Auth & balance listeners (synchronous setup, independent of init)
    const unsubAuth = onAuthStateChanged((user) => {
      setIsAuthenticated(!!user);
      if (user && checkTokenMode()) {
        setShowWelcome(false);
        refreshBalance().then(setTokenBalance).catch(console.error);
        reconcilePendingPurchases(user.uid).catch(console.error);
      } else if (!user) {
        pendingRecoveryForUidRef.current = null;
        if (checkTokenMode() && !loadApiKey()) {
          setShowWelcome(true);
        }
      }
    });

    const unsubBalance = subscribeToBalance(setTokenBalance);

    return () => {
      unsubAuth();
      unsubBalance();
    };
  }, [reconcilePendingPurchases]);

  // Sync viewingVersion with versions list (allows live updates in modal)
  useEffect(() => {
    if (viewingVersion) {
        const updated = versions.find(v => v.id === viewingVersion.id);
        if (updated && updated.critique !== viewingVersion.critique) {
            setViewingVersion(updated);
        }
    }
  }, [versions, viewingVersion]);

  const updatePhase = (phase: AppPhase, extra?: Partial<GenerationState>) => {
    phaseRef.current = phase;
    setState(prev => ({ ...prev, phase, ...extra }));
  };

  const stopLoop = useCallback(() => {
    isLoopingRef.current = false;
    phaseRef.current = AppPhase.STOPPED;
    updatePhase(AppPhase.STOPPED);
  }, []);

  const saveToHistory = async (id: string, svgCode: string, critique: string | undefined, iteration: number, thumbnail: string) => {
      const safeSvgCode = sanitizeSvg(svgCode);
      const newVersion: SVGVersion = {
          id: id,
          timestamp: Date.now(),
          svgCode: safeSvgCode,
          critique,
          iteration,
          prompt: promptRef.current,
          thumbnail
      };

      await db.saveVersion(newVersion);

      setVersions(prev => {
          // Check if this ID already exists (update it), otherwise add new
          const index = prev.findIndex(v => v.id === id);
          if (index >= 0) {
              const copy = [...prev];
              copy[index] = newVersion;
              return copy;
          }
          return [newVersion, ...prev];
      });
  };

  const handleManualAdd = async (code: string) => {
    const safeCode = sanitizeSvg(code);
    const newVersion: SVGVersion = {
        id: uuidv4(),
        timestamp: Date.now(),
        svgCode: safeCode,
        critique: "Manually added via input.",
        iteration: versions.length + 1,
        prompt: "Manual Entry",
        thumbnail: undefined
    };
    await db.saveVersion(newVersion);
    setVersions(prev => [newVersion, ...prev]);
  };

  const toggleSelect = (id: string) => {
      setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
      });
  };

  const deleteVersions = async (ids: string[]) => {
      for (const id of ids) {
          await db.deleteVersion(id);
      }
      setVersions(prev => prev.filter(v => !ids.includes(v.id)));
      setSelectedIds(new Set()); // Clear selection
      if (viewingVersion && ids.includes(viewingVersion.id)) {
          setViewingVersion(null);
      }
  };

  const runRefinementLoop = async () => {
      if (!isLoopingRef.current) return;

      const handleThought = (thoughtChunk: string) => {
        const normalized = thoughtChunk.trim();
        if (!normalized) return;

        setState(prev => {
          if (prev.lastThoughts[0] === normalized) return prev;
          return { ...prev, lastThoughts: [normalized, ...prev.lastThoughts].slice(0, 2) };
        });
      };

      try {
          // --- INITIALIZATION PHASE ---
          // Use refs to check state to avoid stale closure issues
          if (!latestSVGRef.current) {
              updatePhase(AppPhase.PLANNING, { error: null, lastThoughts: [] });
              const planResult = await gemini.planSVG(promptRef.current, handleThought);

              if(!isLoopingRef.current) return;
              updatePhase(AppPhase.GENERATING, { lastThoughts: [] });
              const svgResult = await gemini.generateInitialSVG(planResult.text, handleThought);
              const safeInitialSvg = sanitizeSvg(svgResult.text);

              latestSVGRef.current = safeInitialSvg;
              setCurrentSVG(safeInitialSvg);
              // Generate the ID for the first iteration (Iteration 1)
              currentVersionIdRef.current = uuidv4();

              iterationRef.current = 1;
              setState(prev => ({...prev, currentIteration: 1, plan: planResult.text }));

              setTimeout(runRefinementLoop, 1500);
              return;
          }

          // --- REFINEMENT LOOP ---

          // 1. RENDER
          updatePhase(AppPhase.RENDERING, { error: null, lastThoughts: [] });
          // Short delay to ensure DOM is ready before capture
          await new Promise(r => setTimeout(r, 200));
          const imageBase64 = await canvasRef.current?.captureImage();

          if (!imageBase64) {
              console.warn("Capture failed, retrying...");
              setTimeout(runRefinementLoop, 1000);
              return;
          }

          // 1b. SAVE (FAST) - Add to gallery immediately without critique
          await saveToHistory(
              currentVersionIdRef.current,
              latestSVGRef.current,
              undefined,
              iterationRef.current,
              imageBase64
          );

          // 2. EVALUATE
          if(!isLoopingRef.current) return;
          updatePhase(AppPhase.EVALUATING, { lastThoughts: [] });
          const critiqueResult = await gemini.evaluateSVG(imageBase64, promptRef.current, iterationRef.current, handleThought);

          setState(prev => ({...prev, lastCritique: critiqueResult.text}));

          // 2b. SAVE (UPDATE) - Update gallery item with critique
          await saveToHistory(
              currentVersionIdRef.current,
              latestSVGRef.current,
              critiqueResult.text,
              iterationRef.current,
              imageBase64
          );

          // 3. REFINE
          if(!isLoopingRef.current) return;
          updatePhase(AppPhase.REFINING, { lastThoughts: [] });
          const refineResult = await gemini.refineSVG(latestSVGRef.current, critiqueResult.text, promptRef.current, handleThought);
          const safeRefinedSvg = sanitizeSvg(refineResult.text);

          latestSVGRef.current = safeRefinedSvg;
          setCurrentSVG(safeRefinedSvg);

          // Prepare for NEXT iteration
          currentVersionIdRef.current = uuidv4();
          iterationRef.current += 1;
          setState(prev => ({...prev, currentIteration: prev.currentIteration + 1}));

          // 4. REPEAT
          setTimeout(runRefinementLoop, 2000);

      } catch (e: any) {
          console.error("Loop Error", e);

          // Check if it's an API key error
          if (e instanceof ApiKeyError) {
              stopLoop();
              setIsApiKeyModalOpen(true);
              updatePhase(AppPhase.STOPPED, { error: e.message });
              return;
          }

          // Check for insufficient tokens
          if (e?.code === 'functions/resource-exhausted' || e?.message?.includes('Insufficient tokens')) {
              stopLoop();
              setIsPurchaseModalOpen(true);
              updatePhase(AppPhase.STOPPED, { error: 'Insufficient tokens. Purchase more to continue.' });
              return;
          }

          if (isLoopingRef.current) {
             setState(prev => ({...prev, error: `Interruption detected: ${e.message || 'Unknown error'}. Retrying in 5s...` }));
             setTimeout(runRefinementLoop, 5000);
          } else {
             updatePhase(AppPhase.STOPPED, { error: e.message });
          }
      }
  };

  const requestStartLoop = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    // Check if user has API key OR is in token mode with auth
    const apiKey = loadApiKey();
    if (!apiKey && !isTokenMode) {
      setIsApiKeyModalOpen(true);
      return;
    }

    if (isTokenMode && !apiKey && !isAuthenticated) {
      setShowWelcome(true);
      return;
    }

    // Show token estimate before starting
    setShowEstimate(true);
    setIsEstimating(true);
    setTokenEstimate(null);

    try {
      const estimate = await gemini.estimateFullCycleCost(trimmed);
      setTokenEstimate(estimate);
    } catch (err) {
      console.error('Failed to estimate tokens:', err);
      // Still allow starting even if estimation fails
      setTokenEstimate({
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedTotal: 0,
      });
    } finally {
      setIsEstimating(false);
    }
  };

  const confirmStart = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;

    setShowEstimate(false);
    setTokenEstimate(null);

    setPrompt(trimmed);
    promptRef.current = trimmed;
    isLoopingRef.current = true;

    // Reset state for a fresh run
    latestSVGRef.current = '';
    setCurrentSVG('');
    currentVersionIdRef.current = '';
    iterationRef.current = 0;
    phaseRef.current = AppPhase.IDLE;

    setState({
        phase: AppPhase.PLANNING,
        currentIteration: 0,
        lastCritique: null,
        lastThoughts: [],
        plan: null,
        error: null
    });

    runRefinementLoop();
  };

  const cancelEstimate = () => {
    setShowEstimate(false);
    setTokenEstimate(null);
    setIsEstimating(false);
  };

  const handleApiKeySaved = () => {
    setHasApiKey(true);
    setIsTokenMode(false); // Switch to API key mode
    gemini.resetAI(); // Reset the API client to use the new key
  };

  const handleOpenApiKeyModal = () => {
    setIsApiKeyModalOpen(true);
  };

  const handleOpenAccountModal = () => {
    setIsAccountModalOpen(true);
  };

  const handleSignOut = async () => {
    stopLoop();
    await signOut();
    pendingRecoveryForUidRef.current = null;
    setTokenBalance(0);
    setIsAuthenticated(false);

    if (checkTokenMode() && !loadApiKey()) {
      setShowWelcome(true);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    stopLoop();

    try {
      await deleteMyAccount();
      await signOut().catch(() => {});
      await db.clearHistory().catch(() => {});
      pendingRecoveryForUidRef.current = null;
      setTokenBalance(0);
      setVersions([]);
      setViewingVersion(null);
      setIsAuthenticated(false);
      setShowWelcome(true);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleWelcomeComplete = (mode: 'tokens' | 'apikey') => {
    setShowWelcome(false);
    if (mode === 'apikey') {
      setIsApiKeyModalOpen(true);
      setIsTokenMode(false);
    } else {
      setIsTokenMode(true);
      // Balance will be refreshed by auth state listener
    }
  };

  const handlePurchaseComplete = () => {
    setIsPurchaseModalOpen(false);
    refreshBalance().then(setTokenBalance).catch(console.error);
  };

  const isThinking = state.phase !== AppPhase.IDLE &&
                     state.phase !== AppPhase.STOPPED &&
                     state.phase !== AppPhase.RENDERING;

  // Show welcome screen for first-time Android users
  if (showWelcome) {
    return <WelcomeScreen onComplete={handleWelcomeComplete} />;
  }

  return (
    <div className="min-h-screen p-4 md:p-10 overflow-x-hidden relative">
      <SketchSvgFilters />

      {/* Corner doodles */}
      <div className="absolute top-4 left-4 text-muted-foreground/10 hidden md:block pointer-events-none">
        <svg width="60" height="60" viewBox="0 0 60 60">
          <path d="M5 5 Q30 10 55 5 Q50 30 55 55 Q30 50 5 55 Q10 30 5 5" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </div>
      <div className="absolute bottom-4 right-4 text-muted-foreground/10 hidden md:block pointer-events-none">
        <svg width="50" height="50" viewBox="0 0 50 50">
          <circle cx="25" cy="25" r="20" stroke="currentColor" strokeWidth="1" fill="none" strokeDasharray="3 4" />
          <circle cx="25" cy="25" r="3" fill="currentColor" opacity="0.3" />
        </svg>
      </div>

      <div className="max-w-[1200px] mx-auto relative z-10">
        <Header
          onOpenApiKeyModal={handleOpenApiKeyModal}
          isTokenMode={isTokenMode && !hasApiKey}
          onOpenPurchaseModal={() => setIsPurchaseModalOpen(true)}
          canManageAccount={isTokenMode && !hasApiKey && isAuthenticated}
          onOpenAccountModal={handleOpenAccountModal}
        />

        <ActiveStage
            phase={state.phase}
            prompt={prompt}
            setPrompt={setPrompt}
            onStart={requestStartLoop}
            onStop={stopLoop}
            svgCode={currentSVG}
            canvasRef={canvasRef}
            critique={state.lastCritique}
            thoughts={state.lastThoughts}
            isThinking={isThinking}
            plan={state.plan}
            iteration={state.currentIteration}
        />

        {state.error && isLoopingRef.current && (
             <div className="mb-6 p-4 bg-yellow-50/50 border border-yellow-200 text-yellow-700 text-sm font-hand sketchy-border-thin animate-pulse">
                {state.error}
             </div>
        )}

        <ManualEntry
            onAdd={handleManualAdd}
            onClear={() => {}}
        />

        <Gallery
            versions={versions}
            viewingId={viewingVersion?.id || null}
            onSelect={setViewingVersion}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onDelete={deleteVersions}
        />

        <footer className="mt-16 text-center">
          <p className="font-hand text-sm text-muted-foreground/40">
            ~ made with pencil shavings & pixels ~
          </p>
          <div className="mt-2 space-x-3">
            {PRIVACY_POLICY_URL && (
              <a
                href={PRIVACY_POLICY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-hand text-xs text-accent underline hover:text-accent/80"
              >
                Privacy policy
              </a>
            )}
            {SUPPORT_EMAIL && (
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-hand text-xs text-muted-foreground hover:text-foreground"
              >
                {SUPPORT_EMAIL}
              </a>
            )}
          </div>
        </footer>
      </div>

      <Modal
        version={viewingVersion}
        onClose={() => setViewingVersion(null)}
      />

      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        onKeySaved={handleApiKeySaved}
        onBack={() => {
          setIsApiKeyModalOpen(false);
          setShowWelcome(true);
        }}
      />

      {showEstimate && (
        <TokenEstimate
          estimate={tokenEstimate}
          balance={tokenBalance}
          isTokenMode={isTokenMode && !hasApiKey}
          isLoading={isEstimating}
          onConfirm={confirmStart}
          onCancel={cancelEstimate}
          onBuyTokens={() => {
            cancelEstimate();
            setIsPurchaseModalOpen(true);
          }}
        />
      )}

      <TokenPurchase
        isOpen={isPurchaseModalOpen}
        onClose={() => setIsPurchaseModalOpen(false)}
        onPurchaseComplete={handlePurchaseComplete}
      />

      <AccountModal
        isOpen={isAccountModalOpen}
        isAuthenticated={isAuthenticated}
        isDeleting={isDeletingAccount}
        privacyPolicyUrl={PRIVACY_POLICY_URL}
        supportEmail={SUPPORT_EMAIL}
        onClose={() => setIsAccountModalOpen(false)}
        onSignOut={handleSignOut}
        onDeleteAccount={handleDeleteAccount}
      />
    </div>
  );
};

export default App;
