import React from 'react';
import { SVGVersion } from '../types';
import { Clock, Download, Code } from 'lucide-react';

interface HistorySidebarProps {
  versions: SVGVersion[];
  selectedId: string | null;
  onSelect: (version: SVGVersion) => void;
}

const HistorySidebar: React.FC<HistorySidebarProps> = ({ versions, selectedId, onSelect }) => {
  const handleDownload = (e: React.MouseEvent, version: SVGVersion) => {
    e.stopPropagation();
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
    <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col h-full">
      <div className="p-4 border-b border-gray-800">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Clock size={18} /> History ({versions.length})
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
        {versions.map((v) => (
          <div
            key={v.id}
            onClick={() => onSelect(v)}
            className={`p-3 rounded-lg cursor-pointer transition-all border ${
              selectedId === v.id
                ? 'bg-gray-800 border-blue-500'
                : 'bg-gray-850 border-gray-800 hover:border-gray-600'
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-mono text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded">
                v{v.iteration}
              </span>
              <span className="text-xs text-gray-500">
                {new Date(v.timestamp).toLocaleTimeString()}
              </span>
            </div>
            
            <div className="w-full h-24 bg-gray-950 rounded mb-2 overflow-hidden flex items-center justify-center p-1">
                 {/* Using the thumbnail if available, else standard rendering (expensive) or just icon */}
                 {v.thumbnail ? (
                     <img src={v.thumbnail} alt={`v${v.iteration}`} className="max-w-full max-h-full object-contain opacity-80" />
                 ) : (
                     <Code size={24} className="text-gray-700" />
                 )}
            </div>

            {v.critique && (
              <p className="text-xs text-gray-400 line-clamp-2 italic mb-2">
                "{v.critique}"
              </p>
            )}

            <div className="flex gap-2 mt-2">
                <button 
                    onClick={(e) => handleDownload(e, v)}
                    className="flex-1 flex items-center justify-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 py-1.5 rounded transition-colors"
                >
                    <Download size={12} /> SVG
                </button>
            </div>
          </div>
        ))}
        {versions.length === 0 && (
            <div className="text-center text-gray-600 mt-10 p-4">
                No versions yet. Start the loop!
            </div>
        )}
      </div>
    </div>
  );
};

export default HistorySidebar;
