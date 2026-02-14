import React from 'react';
import { SVGVersion } from '../types';
import { X, Copy, Download, MessageSquare } from 'lucide-react';

interface ModalProps {
  version: SVGVersion | null;
  onClose: () => void;
}

const Modal: React.FC<ModalProps> = ({ version, onClose }) => {
  if (!version) return null;

  const copyCode = () => {
    navigator.clipboard.writeText(version.svgCode);
  };
  
  const downloadSVG = () => {
    const blob = new Blob([version.svgCode], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iteration-${version.iteration}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div 
        className="bg-card sketchy-border w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl relative" 
        onClick={e => e.stopPropagation()}
      >
        {/* Close Button */}
        <button onClick={onClose} className="absolute top-4 right-4 z-20 p-2 bg-muted/20 hover:bg-muted/50 rounded-full transition-colors text-foreground">
            <X size={24} />
        </button>

        <div className="flex flex-col lg:flex-row h-full">
            
            {/* Image Section */}
            <div className="flex-1 bg-white p-10 flex items-center justify-center relative min-h-[400px]">
                 {/* Paper Grid */}
                 <div className="absolute inset-0 opacity-10 pointer-events-none" 
                      style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '40px 40px' }} 
                 />
                 
                 <div 
                    className="w-full h-full relative z-10 flex items-center justify-center p-4 [&>svg]:w-auto [&>svg]:h-auto [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:drop-shadow-lg" 
                    dangerouslySetInnerHTML={{ __html: version.svgCode }} 
                 />
            </div>

            {/* Info Section */}
            <div className="w-full lg:w-[450px] bg-paper-dark border-t lg:border-t-0 lg:border-l border-border flex flex-col">
                <div className="p-6 border-b border-border border-dashed">
                    <h2 className="font-sketch text-4xl text-foreground">Iteration #{version.iteration}</h2>
                    <p className="font-hand text-muted-foreground mt-1">{new Date(version.timestamp).toLocaleString()}</p>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    {version.critique && (
                        <div>
                            <h3 className="font-sketch text-2xl text-accent mb-2 flex items-center gap-2">
                                <MessageSquare size={20} /> Critique
                            </h3>
                            <div className="font-hand text-lg leading-relaxed text-foreground/80 bg-white/50 p-4 rounded-lg border border-border">
                                {version.critique}
                            </div>
                        </div>
                    )}

                    <div>
                        <h3 className="font-sketch text-2xl text-foreground mb-2">Code Snippet</h3>
                        <div className="bg-background border border-border rounded p-3 relative group">
                            <button onClick={copyCode} className="absolute top-2 right-2 p-1 bg-muted/50 rounded hover:bg-muted text-foreground transition-colors" title="Copy">
                                <Copy size={14} />
                            </button>
                            <pre className="text-xs font-mono text-muted-foreground overflow-x-auto p-1 h-[150px] custom-scrollbar">
                                {version.svgCode}
                            </pre>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-border bg-background/50">
                    <button 
                        onClick={downloadSVG} 
                        className="w-full py-3 sketchy-border-thin font-sketch text-xl hover:bg-accent hover:text-white hover:border-accent transition-all flex items-center justify-center gap-2"
                    >
                        <Download size={20} /> Save to Disk
                    </button>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Modal;