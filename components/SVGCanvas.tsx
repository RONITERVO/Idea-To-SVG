import React, { useRef, forwardRef, useImperativeHandle, useMemo } from 'react';
import { sanitizeSvg } from '../services/svgSanitizer';

interface SVGCanvasProps {
  svgCode: string;
}

export interface SVGCanvasHandle {
  captureImage: () => Promise<string>;
}

const SVGCanvas = forwardRef<SVGCanvasHandle, SVGCanvasProps>(({ svgCode }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const safeSvgCode = useMemo(() => sanitizeSvg(svgCode), [svgCode]);

  useImperativeHandle(ref, () => ({
    captureImage: async () => {
      if (!containerRef.current) return '';
      
      const svgElement = containerRef.current.querySelector('svg');
      if (!svgElement) return '';

      // Clone the SVG to not mess with the DOM one
      const clone = svgElement.cloneNode(true) as SVGElement;
      // Ensure dimensions are explicit on the clone for canvas
      clone.setAttribute('width', '800');
      clone.setAttribute('height', '800');

      const svgString = new XMLSerializer().serializeToString(clone);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      const width = 800;
      const height = 800;
      canvas.width = width;
      canvas.height = height;

      const img = new Image();
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      return new Promise((resolve, reject) => {
        img.onload = () => {
          if (ctx) {
            // White background for cleaner evaluation by vision model
            ctx.fillStyle = '#ffffff'; 
            ctx.fillRect(0, 0, width, height);
            
            // Draw image preserving aspect ratio
            const scale = Math.min(width / img.width, height / img.height);
            const x = (width / 2) - (img.width / 2) * scale;
            const y = (height / 2) - (img.height / 2) * scale;
            
            ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/png'));
          } else {
             reject('No context');
          }
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        }
        img.src = url;
      });
    }
  }));

  return (
    <div 
      ref={containerRef}
      className="w-full h-full flex items-center justify-center bg-white overflow-hidden relative min-h-[300px]"
    >
        {/* Paper texture overlay for canvas area */}
        <div className="absolute inset-0 pointer-events-none opacity-50 mix-blend-multiply"
             style={{ 
                 backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.1'/%3E%3C/svg%3E")`
             }}
        />
        
        {/* Subtle Grid */}
        <div className="absolute inset-0 opacity-10 pointer-events-none" 
             style={{ 
                 backgroundImage: 'linear-gradient(#999 1px, transparent 1px), linear-gradient(90deg, #999 1px, transparent 1px)',
                 backgroundSize: '20px 20px'
             }} 
        />
        
      {safeSvgCode ? (
        <div 
            className="w-full h-full flex items-center justify-center p-8 z-10 [&>svg]:w-auto [&>svg]:h-auto [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:drop-shadow-sm"
            dangerouslySetInnerHTML={{ __html: safeSvgCode }} 
        />
      ) : (
        <div className="text-muted-foreground/30 flex flex-col items-center z-10">
          <span className="font-sketch text-4xl mb-2">Empty Page</span>
          <p className="font-hand text-lg">Waiting for ink...</p>
        </div>
      )}
    </div>
  );
});

SVGCanvas.displayName = 'SVGCanvas';
export default SVGCanvas;
