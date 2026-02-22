import React, { useState } from 'react';
import { Coins, Key, LogIn } from 'lucide-react';
import { signInWithGoogle } from '../services/auth';
import { setAppMode } from '../services/platform';
import { refreshBalance } from '../services/tokenManager';
import SketchSvgFilters from './SketchSvgFilters';

interface WelcomeScreenProps {
  onComplete: (mode: 'tokens' | 'apikey') => void;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onComplete }) => {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTokenMode = async () => {
    setIsSigningIn(true);
    setError(null);
    try {
      await signInWithGoogle();
      setAppMode('tokens');
      await refreshBalance();
      onComplete('tokens');
    } catch (err: any) {
      console.error('Sign in failed:', err);
      setError(err.message || 'Sign in failed. Please try again.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleApiKeyMode = () => {
    setAppMode('apikey');
    onComplete('apikey');
  };

  return (
    <div className="min-h-screen p-4 md:p-10 flex items-center justify-center relative">
      <SketchSvgFilters />
      <div className="bg-card sketchy-border w-full max-w-lg p-8 shadow-2xl animate-sketch-in">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <svg width="48" height="48" viewBox="0 0 36 36" fill="none" className="text-foreground animate-wobble">
            <path
              d="M26 4a4.24 4.24 0 0 1 6 6L11.25 30.75 3 33l2.25-8.25L26 4z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M22 8l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <div className="text-center">
            <h1 className="font-sketch text-4xl text-foreground leading-none">Sketch AI</h1>
            <p className="font-hand text-muted-foreground text-lg">Infinite Refinement Loop</p>
          </div>
        </div>

        <p className="font-hand text-lg text-foreground/80 text-center mb-8">
          Generate stunning SVG graphics powered by AI. Choose how you'd like to get started.
        </p>

        {/* Token Mode - Primary */}
        <button
          onClick={handleTokenMode}
          disabled={isSigningIn}
          className="w-full mb-4 p-5 sketchy-border bg-accent/10 hover:bg-accent/20 transition-all flex items-center gap-4 text-left disabled:opacity-50"
        >
          <div className="p-3 bg-accent/20 rounded-lg flex-shrink-0">
            <Coins className="text-accent" size={28} />
          </div>
          <div className="flex-1">
            <h3 className="font-sketch text-xl text-foreground">
              {isSigningIn ? 'Signing in...' : 'Get Started with Tokens'}
            </h3>
            <p className="font-hand text-sm text-muted-foreground mt-1">
              Sign in with Google and purchase token packs. No API key needed.
            </p>
          </div>
          {isSigningIn ? (
            <div className="animate-spin w-5 h-5 border-2 border-accent border-t-transparent rounded-full"></div>
          ) : (
            <LogIn size={20} className="text-muted-foreground flex-shrink-0" />
          )}
        </button>

        {/* API Key Mode - Secondary */}
        <button
          onClick={handleApiKeyMode}
          disabled={isSigningIn}
          className="w-full p-4 sketchy-border-thin hover:bg-muted/30 transition-all flex items-center gap-4 text-left disabled:opacity-50"
        >
          <div className="p-2 bg-muted/30 rounded-lg flex-shrink-0">
            <Key className="text-muted-foreground" size={22} />
          </div>
          <div className="flex-1">
            <h3 className="font-sketch text-lg text-foreground/80">I have an API Key</h3>
            <p className="font-hand text-xs text-muted-foreground mt-0.5">
              For developers with their own Gemini API key. Free and unlimited.
            </p>
          </div>
        </button>

        {error && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
            <p className="font-hand text-sm text-destructive/90">{error}</p>
          </div>
        )}

        <p className="font-hand text-xs text-muted-foreground mt-6 text-center">
          Open source project - your data stays on your device.
        </p>
      </div>
    </div>
  );
};

export default WelcomeScreen;
