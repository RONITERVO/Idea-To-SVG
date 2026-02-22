import React, { useEffect, useRef } from 'react';
import { AppPhase } from '../types';
import SVGCanvas, { SVGCanvasHandle } from './SVGCanvas';
import { PenTool, Eraser } from 'lucide-react';

interface ActiveStageProps {
  phase: AppPhase;
  prompt: string;
  setPrompt: (s: string) => void;
  onStart: () => void;
  onStop: () => void;
  svgCode: string;
  canvasRef: React.RefObject<SVGCanvasHandle | null>;
  critique: string | null;
    thoughts: string[];
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

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
        terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
    }, [critique, plan, phase, iteration]);

    const statusText =
        phase === AppPhase.GENERATING
            ? 'Drafting shapes...'
            : phase === AppPhase.RENDERING
            ? 'Stepping back to look...'
            : phase === AppPhase.REFINING
            ? 'Adding details...'
            : phase === AppPhase.EVALUATING
            ? 'Reviewing the sketch...'
            : phase === AppPhase.PLANNING
            ? 'Planning composition...'
            : null;

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

                    {statusText && (
                        <div className="text-muted-foreground italic animate-fade-in">
                            <div>{statusText}</div>
                            {thoughts.length > 0 && (
                                <div className="mt-1 whitespace-pre-wrap not-italic text-foreground/70 text-base leading-snug">
                                    {thoughts.map((thought, index) => (
                                        <p key={`${index}-${thought.slice(0, 24)}`} className={index > 0 ? 'opacity-80' : ''}>
                                            {thought}
                                        </p>
                                    ))}
                                </div>
                            )}
                            {isThinking && thoughts.length === 0 && (
                                <div className="mt-1 not-italic text-foreground/50 text-base">Thinking...</div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>

      </div>
    </div>
  );
};

export default ActiveStage;