import React from 'react';
import { Key } from 'lucide-react';
import TokenDisplay from './TokenDisplay';

interface HeaderProps {
  onOpenApiKeyModal: () => void;
  isTokenMode: boolean;
  onOpenPurchaseModal: () => void;
}

const Header: React.FC<HeaderProps> = ({ onOpenApiKeyModal, isTokenMode, onOpenPurchaseModal }) => {
  return (
    <header className="mb-12 flex flex-col md:flex-row items-center justify-between gap-4 animate-sketch-in">
      <div className="flex items-center gap-3">
        {/* Logo pencil doodle */}
        <svg width="42" height="42" viewBox="0 0 36 36" fill="none" className="text-foreground animate-wobble">
          <path
            d="M26 4a4.24 4.24 0 0 1 6 6L11.25 30.75 3 33l2.25-8.25L26 4z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M22 8l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <div>
          <h1 className="font-sketch text-4xl md:text-5xl text-foreground tracking-tight leading-none">
            Sketch AI
          </h1>
          <div className="font-hand text-muted-foreground text-lg ml-1">
            Infinite Refinement Loop
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isTokenMode && (
          <TokenDisplay onClick={onOpenPurchaseModal} />
        )}

        <button
          onClick={onOpenApiKeyModal}
          className="p-2 text-muted-foreground hover:text-foreground transition-colors hover:bg-muted/30 rounded-lg"
          title="Manage API Key"
          aria-label="Manage API Key"
        >
          <Key size={20} />
        </button>

        <div className="hidden md:block">
          <svg width="100" height="20" viewBox="0 0 100 20">
             <path d="M0 10 Q25 0 50 10 T100 10" stroke="currentColor" strokeWidth="1" fill="none" className="text-muted-foreground/30" />
          </svg>
        </div>
      </div>
    </header>
  );
};

export default Header;
