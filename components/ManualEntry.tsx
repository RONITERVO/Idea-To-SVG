import React, { useState } from 'react';
import { Plus, X, Code } from 'lucide-react';

interface ManualEntryProps {
  onAdd: (code: string) => void;
  onClear: () => void;
}

const ManualEntry: React.FC<ManualEntryProps> = ({ onAdd, onClear }) => {
  const [input, setInput] = useState('');

  const cleanAndAdd = () => {
    if (!input.trim()) return;

    let clean = input;
    const markdownRegex = /```(?:xml|svg|html|jsx|tsx|javascript|typescript)?\s*([\s\S]*?)\s*```/i;
    const match = clean.match(markdownRegex);
    if (match && match[1]) clean = match[1].trim();
    clean = clean.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

    const svgStartRegex = /<svg[\s\S]*?>/i;
    const startMatch = clean.match(svgStartRegex);
    if (startMatch) {
      const startIndex = startMatch.index!;
      const startTag = startMatch[0];
      if (startTag.trim().endsWith('/>')) {
         clean = startTag;
      } else {
         const remainder = clean.substring(startIndex);
         const svgEndRegex = /<\/\s*svg>/i;
         const endMatch = remainder.match(svgEndRegex);
         if (endMatch) {
            clean = remainder.substring(0, endMatch.index! + endMatch[0].length);
         } else {
            clean = remainder;
         }
      }
    }

    clean = clean.replace(/export\s+default\s+function\s*[\w]*\s*\([\s\S]*?\)\s*\{/gi, '')
                 .replace(/export\s+default\s+\([\s\S]*?\)\s*=>\s*\(?/gi, '')
                 .replace(/const\s+[\w]+\s*=\s*\([\s\S]*?\)\s*=>\s*\(?/gi, '')
                 .replace(/^[\s\S]*?=>\s*\(\s*/, '')
                 .replace(/^[\s\S]*?return\s*\(\s*/, '')
                 .replace(/\{\s*\.\.\.\s*props\s*\}/gi, '')
                 .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
                 .replace(/\sclassName=/g, ' class=')
                 .replace(/\shtmlFor=/g, ' for=');

    // ... (rest of cleaning logic could go here if needed, keeping it simple for display)

    onAdd(clean.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      cleanAndAdd();
    }
  };

  return (
    <div className="mb-16">
      <h3 className="font-sketch text-2xl text-foreground mb-4">04. Manual Input</h3>
      
      <div className="bg-secondary/30 p-6 sketchy-border-thin relative">
        <div className="flex items-center gap-2 mb-2 text-muted-foreground font-hand">
            <Code size={16} />
            <span>Paste raw SVG code here to add to gallery</span>
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="<svg>...</svg>"
          className="w-full h-32 bg-background border border-muted p-4 font-mono text-xs focus:outline-none focus:border-accent transition-colors rounded resize-y mb-4"
        />

        <div className="flex gap-4">
          <button
            onClick={cleanAndAdd}
            disabled={!input.trim()}
            className="px-6 py-2 bg-foreground text-background font-hand font-bold rounded shadow hover:bg-foreground/90 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            <Plus size={16} /> Add to Collection
          </button>
          <button
            onClick={() => { setInput(''); onClear(); }}
            className="px-6 py-2 text-muted-foreground font-hand hover:text-foreground transition-colors flex items-center gap-2"
          >
            <X size={16} /> Clear
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManualEntry;