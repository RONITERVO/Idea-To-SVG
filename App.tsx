import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AppPhase, GenerationState, SVGVersion } from './types';
import * as db from './services/db';
import * as gemini from './services/gemini';
import { loadApiKey, ApiKeyError } from './services/apiKeyStorage';
import { SVGCanvasHandle } from './components/SVGCanvas';

import Header from './components/Header';
import ActiveStage from './components/ActiveStage';
import Gallery from './components/Gallery';
import Modal from './components/Modal';
import ManualEntry from './components/ManualEntry';
import SketchSvgFilters from './components/SketchSvgFilters';
import ApiKeyModal from './components/ApiKeyModal';

const App: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<GenerationState>({
    phase: AppPhase.IDLE,
    currentIteration: 0,
    lastCritique: null,
    lastThoughts: null,
    plan: null,
    error: null,
  });
  
  const [versions, setVersions] = useState<SVGVersion[]>([]);
  const [currentSVG, setCurrentSVG] = useState<string>('');
  const [viewingVersion, setViewingVersion] = useState<SVGVersion | null>(null);
  
  // API Key State
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);
  
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

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const saved = await db.getAllVersions();
        setVersions(saved);
      } catch (e) {
        console.error("Failed to load history", e);
      }
    };
    loadHistory();

    // Check for API key on mount
    const apiKey = loadApiKey();
    setHasApiKey(!!apiKey);
    if (!apiKey) {
      setIsApiKeyModalOpen(true);
    }
  }, []);

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
      const newVersion: SVGVersion = {
          id: id,
          timestamp: Date.now(),
          svgCode,
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
    const newVersion: SVGVersion = {
        id: uuidv4(),
        timestamp: Date.now(),
        svgCode: code,
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

      const handleThought = (thoughts: string) => {
        setState(prev => ({ ...prev, lastThoughts: thoughts }));
      };

      try {
          // --- INITIALIZATION PHASE ---
          // Use refs to check state to avoid stale closure issues
          if (!latestSVGRef.current) {
              updatePhase(AppPhase.PLANNING, { error: null, lastThoughts: null });
              const planResult = await gemini.planSVG(promptRef.current, handleThought);

              if(!isLoopingRef.current) return;
              updatePhase(AppPhase.GENERATING, { lastThoughts: null });
              const svgResult = await gemini.generateInitialSVG(planResult.text, handleThought);

              latestSVGRef.current = svgResult.text;
              setCurrentSVG(svgResult.text);
              // Generate the ID for the first iteration (Iteration 1)
              currentVersionIdRef.current = uuidv4();

              iterationRef.current = 1;
              setState(prev => ({...prev, currentIteration: 1, plan: planResult.text }));

              setTimeout(runRefinementLoop, 1500);
              return;
          }

          // --- REFINEMENT LOOP ---

          // 1. RENDER
          updatePhase(AppPhase.RENDERING, { error: null, lastThoughts: null });
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
          updatePhase(AppPhase.EVALUATING, { lastThoughts: null });
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
          updatePhase(AppPhase.REFINING, { lastThoughts: null });
          const refineResult = await gemini.refineSVG(latestSVGRef.current, critiqueResult.text, promptRef.current, handleThought);

          latestSVGRef.current = refineResult.text;
          setCurrentSVG(refineResult.text);

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
          
          if (isLoopingRef.current) {
             setState(prev => ({...prev, error: `Interruption detected: ${e.message || 'Unknown error'}. Retrying in 5s...` }));
             setTimeout(runRefinementLoop, 5000); 
          } else {
             updatePhase(AppPhase.STOPPED, { error: e.message });
          }
      }
  };

  const startLoop = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    
    // Check for API key before starting
    if (!hasApiKey) {
      setIsApiKeyModalOpen(true);
      return;
    }

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
        lastThoughts: null,
        plan: null,
        error: null
    });
    
    runRefinementLoop();
  };

  const handleApiKeySaved = () => {
    setHasApiKey(true);
    gemini.resetAI(); // Reset the API client to use the new key
  };

  const handleOpenApiKeyModal = () => {
    setIsApiKeyModalOpen(true);
  };

  const isThinking = state.phase !== AppPhase.IDLE &&
                     state.phase !== AppPhase.STOPPED &&
                     state.phase !== AppPhase.RENDERING;

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
        <Header onOpenApiKeyModal={handleOpenApiKeyModal} />
        
        <ActiveStage
            phase={state.phase}
            prompt={prompt}
            setPrompt={setPrompt}
            onStart={startLoop}
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
                ⚠ {state.error}
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
      />
    </div>
  );
};

export default App;