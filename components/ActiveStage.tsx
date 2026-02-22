import React, { useEffect, useRef, useState } from 'react';
import { AppPhase } from '../types';
import SVGCanvas, { SVGCanvasHandle } from './SVGCanvas';
import { Play, Square, PenTool, Eraser, Brain, ChevronDown, ChevronRight } from 'lucide-react';

interface ActiveStageProps {
  phase: AppPhase;
  prompt: string;
  setPrompt: (s: string) => void;
  onStart: () => void;
  onStop: () => void;
  svgCode: string;
  canvasRef: React.RefObject<SVGCanvasHandle | null>;
  critique: string | null;
  thoughts: string | null;
  isThinking?: boolean;
  plan: string | null;
  iteration: number;
}

const ActiveStage: React.FC<ActiveStageProps> = ({
  phase,
  prompt,
  setPrompt,
  onStart,
  onStop,
  svgCode,
  canvasRef,
  critique,
  thoughts,
  isThinking,
  plan,
  iteration
}) => {
  const isIdle = phase === AppPhase.IDLE || phase === AppPhase.STOPPED;
  const terminalRef = useRef<HTMLDivElement>(null);
  const thoughtsContentRef = useRef<HTMLDivElement>(null);
  const [thoughtsExpanded, setThoughtsExpanded] = useState(false);
  const prevThoughtsRef = useRef<string | null>(null);

  // Auto-expand thoughts when a new stream begins (null -> non-null transition)
  useEffect(() => {
    if (thoughts && !prevThoughtsRef.current) {
      setThoughtsExpanded(true);
    }
    prevThoughtsRef.current = thoughts;
  }, [thoughts]);

  // Auto-scroll thoughts container as new text streams in
  useEffect(() => {
    if (thoughtsContentRef.current && thoughtsExpanded) {
      thoughtsContentRef.current.scrollTop = thoughtsContentRef.current.scrollHeight;
    }
  }, [thoughts, thoughtsExpanded]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
        terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [critique, plan, phase, iteration, thoughts]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        if (isIdle && prompt.trim()) onStart();
    }
  };

  return (
    <div className="mb-12 animate-sketch-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Input / Canvas */}
        <div className="lg:col-span-2 flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h3 className="font-sketch text-2xl text-foreground">01. Sketchpad</h3>
                {!isIdle && (
                    <span className="font-hand text-accent text-sm animate-pulse uppercase tracking-widest">
                       Creating... {phase}
                    </span>
                )}
            </div>

            <div className="relative">
                {isIdle ? (
                    <div className="torn-paper bg-card p-1 shadow-md">
                        <div className="notebook-lines min-h-[350px] relative bg-paper">
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Describe what you'd like me to sketch..."
                                className="w-full h-full min-h-[350px] bg-transparent px-6 py-4 font-hand text-xl text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none leading-[32px]"
                            />
                            {/* Pencil decoration */}
                            <div className="absolute -right-4 -bottom-4 text-muted-foreground/30 transform rotate-12">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                                </svg>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="sketchy-border bg-white p-2 relative shadow-lg min-h-[400px] flex flex-col">
                         <div className="absolute -top-3 -left-3 bg-accent text-white px-3 py-1 font-architect text-sm transform -rotate-6 shadow-sm z-20">
                            Iteration #{iteration}
                         </div>
                         <div className="flex-1 border border-dashed border-muted rounded-lg overflow-hidden relative">
                             <SVGCanvas ref={canvasRef} svgCode={svgCode} />
                         </div>
                    </div>
                )}
            </div>
            
            {/* Controls */}
            <div className="flex justify-center mt-2">
                {isIdle ? (
                    <button
                        onClick={onStart}
                        disabled={!prompt.trim()}
                        className="group relative px-8 py-3 font-sketch text-2xl sketchy-border cursor-pointer transition-all duration-300 bg-primary text-primary-foreground hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:-rotate-1"
                    >
                        <span className="flex items-center gap-2">
                            <PenTool size={20} className="group-hover:rotate-12 transition-transform" />
                            Start Sketching
                        </span>
                    </button>
                ) : (
                    <button
                        onClick={onStop}
                        className="group relative px-8 py-3 font-sketch text-2xl sketchy-border cursor-pointer transition-all duration-300 bg-white text-destructive border-destructive hover:bg-destructive/5 hover:shadow-lg hover:rotate-1"
                    >
                        <span className="flex items-center gap-2">
                            <Eraser size={20} className="group-hover:wobble" />
                            Stop Drawing
                        </span>
                    </button>
                )}
            </div>
        </div>

        {/* Right Column: Notes / Log */}
        <div className="flex flex-col h-full">
            <h3 className="font-sketch text-2xl text-foreground mb-4">02. Artist Notes</h3>
            <div className="flex-1 bg-secondary/50 sketchy-border-thin p-4 relative min-h-[300px] max-h-[600px] flex flex-col">
                {/* Spiral binding visual */}
                <div className="absolute left-4 top-0 bottom-0 w-8 flex flex-col gap-4 py-4 pointer-events-none">
                    {[...Array(10)].map((_, i) => (
                        <div key={i} className="w-4 h-4 rounded-full bg-background border border-muted-foreground/30 shadow-inner" />
                    ))}
                </div>

                <div ref={terminalRef} className="flex-1 overflow-y-auto pl-10 pr-2 font-hand text-lg leading-relaxed custom-scrollbar space-y-4">
                    {isIdle && !critique && !plan && (
                        <div className="text-muted-foreground italic opacity-70">
                            Ready to start...<br/>
                            Waiting for your idea...
                        </div>
                    )}
                    
                    {(thoughts || isThinking) && (
                        <div className="animate-fade-in">
                            <button
                                onClick={() => setThoughtsExpanded(!thoughtsExpanded)}
                                className="flex items-center gap-1.5 text-purple-600 font-bold mb-1 underline decoration-wavy decoration-purple-300/30 cursor-pointer hover:text-purple-700 transition-colors"
                            >
                                <Brain size={16} />
                                <span>Thoughts</span>
                                {isThinking && !thoughts && <span className="ml-2 text-xs text-purple-400 no-underline">(thinking...)</span>}
                                {thoughtsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                            {thoughtsExpanded && (
                                <div ref={thoughtsContentRef} className="text-foreground/60 text-base whitespace-pre-wrap bg-purple-50/50 rounded p-2 border border-dashed border-purple-200/50 max-h-[200px] overflow-y-auto custom-scrollbar">
                                    {thoughts || <span className="text-purple-300 italic">Thinking...</span>}
                                    {isThinking && <span className="inline-block w-1.5 h-4 bg-purple-400 ml-0.5 animate-pulse align-middle" />}
                                </div>
                            )}
                        </div>
                    )}

                    {plan && (
                        <div className="animate-fade-in relative">
                            <span className="text-accent font-bold block mb-1 underline decoration-wavy decoration-muted-foreground/30">Plan:</span>
                            <p className="text-foreground/80">{plan}</p>
                        </div>
                    )}

                    {critique && (
                        <div className="animate-fade-in pt-4 border-t border-dashed border-muted-foreground/20">
                            <span className="text-accent font-bold block mb-1 underline decoration-wavy decoration-muted-foreground/30">Critique:</span>
                            <div className="text-foreground/80 whitespace-pre-wrap">
                                {critique}
                            </div>
                        </div>
                    )}

                    {phase === AppPhase.GENERATING && (
                        <div className="text-muted-foreground italic">Drafting shapes...</div>
                    )}
                    {phase === AppPhase.RENDERING && (
                        <div className="text-muted-foreground italic">Stepping back to look...</div>
                    )}
                    {phase === AppPhase.REFINING && (
                        <div className="text-muted-foreground italic">Adding details...</div>
                    )}
                </div>
            </div>
        </div>

      </div>
    </div>
  );
};

export default ActiveStage;