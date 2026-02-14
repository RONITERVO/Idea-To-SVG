import React from 'react';
import { Play, Square, Loader2, Sparkles } from 'lucide-react';
import { AppPhase } from '../types';

interface ControlsProps {
  prompt: string;
  setPrompt: (s: string) => void;
  phase: AppPhase;
  onStart: () => void;
  onStop: () => void;
}

const Controls: React.FC<ControlsProps> = ({ prompt, setPrompt, phase, onStart, onStop }) => {
  const isRunning = phase !== AppPhase.IDLE && phase !== AppPhase.STOPPED;

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (!isRunning && prompt.trim()) {
              onStart();
          }
      }
  }

  return (
    <div className="bg-gray-900 border-b border-gray-800 p-4">
      <div className="max-w-4xl mx-auto flex gap-4">
        <div className="flex-1 relative">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            placeholder="Describe an ambiguous concept (e.g., 'Digital serenity', 'Chaos in order')..."
            className="w-full bg-gray-950 text-white border border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <Sparkles className="absolute right-3 top-3.5 text-gray-500" size={18} />
        </div>
        
        {isRunning ? (
          <button
            onClick={onStop}
            className="bg-red-500/10 text-red-400 border border-red-500/50 hover:bg-red-500/20 px-6 rounded-lg font-medium flex items-center gap-2 transition-all"
          >
            <Square size={18} fill="currentColor" /> Stop Loop
          </button>
        ) : (
          <button
            onClick={onStart}
            disabled={!prompt.trim()}
            className="bg-blue-600 hover:bg-blue-500 text-white px-8 rounded-lg font-medium flex items-center gap-2 transition-all disabled:opacity-50 disabled:hover:bg-blue-600"
          >
            <Play size={18} fill="currentColor" /> Start Engine
          </button>
        )}
      </div>
      
      {/* Phase Indicator */}
      <div className="max-w-4xl mx-auto mt-2 h-6 flex items-center">
         {isRunning && (
             <div className="flex items-center gap-2 text-sm text-blue-400 animate-pulse">
                 <Loader2 size={14} className="animate-spin" />
                 <span className="font-mono uppercase tracking-wider">{phase}</span>
             </div>
         )}
      </div>
    </div>
  );
};

export default Controls;
