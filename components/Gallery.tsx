import React from 'react';
import { SVGVersion } from '../types';
import { Download, Eye, Trash2, CheckSquare, Square } from 'lucide-react';

interface GalleryProps {
  versions: SVGVersion[];
  onSelect: (v: SVGVersion) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onDelete: (ids: string[]) => void;
  viewingId: string | null;
}

const Gallery: React.FC<GalleryProps> = ({ 
    versions, 
    onSelect, 
    selectedIds, 
    onToggleSelect, 
    onDelete,
    viewingId 
}) => {
  
  const downloadSVG = (e: React.MouseEvent, v: SVGVersion) => {
    e.stopPropagation();
    const blob = new Blob([v.svgCode], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iteration-${v.iteration}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDeleteSelected = () => {
    if (window.confirm(`Scrap ${selectedIds.size} sketches?`)) {
        onDelete(Array.from(selectedIds));
    }
  };

  return (
    <div className="pb-20 animate-fade-in">
        
        {/* Header Actions */}
        <div className="flex flex-col md:flex-row gap-6 mb-8 items-center justify-between">
            <h3 className="font-sketch text-3xl text-foreground">03. Gallery Wall</h3>
            
            {selectedIds.size > 0 && (
                <button 
                    onClick={handleDeleteSelected}
                    className="sketchy-border-thin px-4 py-2 text-destructive hover:bg-destructive/10 font-hand text-lg transition-all flex items-center gap-2"
                >
                    <Trash2 size={18} />
                    Scrap Selected ({selectedIds.size})
                </button>
            )}
        </div>

        {versions.length === 0 ? (
            <div className="py-20 border-2 border-dashed border-muted rounded-lg text-center bg-secondary/20">
                <div className="font-sketch text-3xl text-muted-foreground opacity-50">Empty Canvas</div>
                <div className="font-hand text-muted-foreground mt-2">Start sketching to fill this wall!</div>
            </div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                {versions.map((v, i) => {
                    const isSelected = selectedIds.has(v.id);
                    const rotation = (i % 2 === 0 ? 1 : -1) * (0.5 + Math.random() * 1.5);
                    
                    return (
                        <div 
                            key={v.id}
                            onClick={() => onSelect(v)}
                            className="relative group cursor-pointer transition-transform duration-300 hover:z-10 hover:scale-105"
                            style={{ transform: `rotate(${rotation}deg)` }}
                        >
                            {/* Tape */}
                            <div className="tape-effect" />

                            <div 
                                className={`bg-card p-3 pb-8 shadow-md hover:shadow-xl transition-all relative border border-border
                                    ${isSelected ? 'ring-2 ring-accent' : ''}
                                `}
                                style={{ borderRadius: '2px' }}
                            >
                                {/* Selection Box */}
                                <div 
                                    onClick={(e) => { e.stopPropagation(); onToggleSelect(v.id); }}
                                    className="absolute top-2 right-2 z-20 text-muted-foreground hover:text-accent transition-colors bg-white/80 rounded p-1"
                                >
                                    {isSelected ? <CheckSquare size={20} className="text-accent" /> : <Square size={20} />}
                                </div>

                                {/* Image Area */}
                                <div className="aspect-square bg-white border border-muted/20 overflow-hidden relative group-hover:border-muted/40 transition-colors">
                                    {/* Grid background */}
                                    <div className="absolute inset-0 opacity-10 pointer-events-none" 
                                        style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '10px 10px' }} 
                                    />
                                    
                                    {v.thumbnail ? (
                                        <img src={v.thumbnail} className="w-full h-full object-contain p-4" alt={`v${v.iteration}`} />
                                    ) : (
                                        <div 
                                          dangerouslySetInnerHTML={{ __html: v.svgCode }} 
                                          className="w-full h-full flex items-center justify-center p-4 [&>svg]:w-auto [&>svg]:h-auto [&>svg]:max-w-full [&>svg]:max-h-full" 
                                        />
                                    )}

                                    {/* Overlay Actions */}
                                    <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 backdrop-blur-[1px]">
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); onSelect(v); }}
                                            className="p-2 bg-white rounded-full text-foreground shadow-sm hover:scale-110 transition-transform"
                                            title="View"
                                        >
                                            <Eye size={18} />
                                        </button>
                                        <button 
                                            onClick={(e) => downloadSVG(e, v)}
                                            className="p-2 bg-white rounded-full text-foreground shadow-sm hover:scale-110 transition-transform"
                                            title="Download"
                                        >
                                            <Download size={18} />
                                        </button>
                                    </div>
                                </div>

                                {/* Caption */}
                                <div className="mt-3 px-1">
                                    <div className="flex justify-between items-end">
                                        <span className="font-sketch text-xl text-foreground truncate">Iteration #{v.iteration}</span>
                                        <span className="font-hand text-xs text-muted-foreground">{new Date(v.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        )}
    </div>
  );
};

export default Gallery;