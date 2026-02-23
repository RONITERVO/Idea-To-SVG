import React, { useEffect, useState } from 'react';
import { X, Key, Coins, LogIn, LogOut, AlertCircle, UserCircle2 } from 'lucide-react';
import { setApiKey, ApiKeyError } from '../services/apiKeyStorage';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeySaved: () => void;
  hasApiKey: boolean;
  isTokenMode: boolean;
  isAuthenticated: boolean;
  isSigningIn: boolean;
  onModeChange: (mode: 'tokens' | 'apikey') => void;
  onOpenPurchase: () => void;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onOpenAccount: () => void;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  onKeySaved,
  hasApiKey,
  isTokenMode,
  isAuthenticated,
  isSigningIn,
  onModeChange,
  onOpenPurchase,
  onSignIn,
  onSignOut,
  onOpenAccount,
}) => {
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setError(null);
      setKeyInput('');
      setIsSavingKey(false);
      setIsSigningOut(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveKey = async () => {
    setError(null);
    setIsSavingKey(true);
    try {
      await setApiKey(keyInput);
      onKeySaved();
      setKeyInput('');
      onClose();
    } catch (e) {
      if (e instanceof ApiKeyError) {
        setError(e.message);
      } else {
        setError('Failed to save API key.');
      }
    } finally {
      setIsSavingKey(false);
    }
  };

  const handleSignIn = async () => {
    setError(null);
    try {
      await onSignIn();
    } catch (e: any) {
      setError(e?.message || 'Sign in failed.');
    }
  };

  const handleSignOut = async () => {
    setError(null);
    setIsSigningOut(true);
    try {
      await onSignOut();
    } catch (e: any) {
      setError(e?.message || 'Sign out failed.');
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-background/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div
        className="bg-card sketchy-border w-full max-w-lg p-6 relative shadow-2xl animate-sketch-in mt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-muted/20 hover:bg-muted/50 rounded-full transition-colors text-foreground"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 bg-accent/10 rounded-lg">
            <Key className="text-accent" size={24} />
          </div>
          <h2 id="settings-modal-title" className="font-sketch text-3xl text-foreground">Settings</h2>
        </div>

        <div className="mb-5">
          <p className="font-hand text-sm text-muted-foreground mb-2">Generation mode</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onModeChange('tokens')}
              className={`py-2.5 sketchy-border-thin font-hand text-sm transition-all ${
                isTokenMode ? 'bg-accent text-white' : 'hover:bg-muted/30'
              }`}
            >
              Cloud Credits
            </button>
            <button
              onClick={() => onModeChange('apikey')}
              className={`py-2.5 sketchy-border-thin font-hand text-sm transition-all ${
                !isTokenMode ? 'bg-accent text-white' : 'hover:bg-muted/30'
              }`}
            >
              API Key
            </button>
          </div>
        </div>

        {isTokenMode ? (
          <div className="space-y-3">
            {!isAuthenticated ? (
              <>
                <p className="font-hand text-sm text-foreground/80">
                  Sign in with Google to use paid cloud generation and buy GIF credits. Billing settles from actual token usage with fractional precision.
                </p>
                <button
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                  className="w-full py-2.5 sketchy-border-thin font-hand text-base bg-accent text-white hover:bg-accent/90 disabled:bg-muted disabled:text-muted-foreground transition-all flex items-center justify-center gap-2"
                >
                  <LogIn size={16} />
                  {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
                </button>
              </>
            ) : (
              <>
                <p className="font-hand text-xs text-muted-foreground">
                  Per-generation previews show whole-number credits, while the ledger and balance use fractional credits.
                </p>
                <button
                  onClick={onOpenPurchase}
                  className="w-full py-2.5 sketchy-border-thin font-hand text-base bg-accent text-white hover:bg-accent/90 transition-all flex items-center justify-center gap-2"
                >
                  <Coins size={16} />
                  Buy GIF Credits
                </button>
                <button
                  onClick={onOpenAccount}
                  className="w-full py-2.5 sketchy-border-thin font-hand text-base hover:bg-muted/30 transition-all flex items-center justify-center gap-2"
                >
                  <UserCircle2 size={16} />
                  Manage Account
                </button>
                <button
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="w-full py-2.5 sketchy-border-thin font-hand text-base hover:bg-muted/30 transition-all flex items-center justify-center gap-2"
                >
                  <LogOut size={16} />
                  {isSigningOut ? 'Signing out...' : 'Sign out'}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="font-hand text-sm text-foreground/80">
              Use your own Gemini API key to generate without consuming GIF credits.
            </p>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value);
                setError(null);
              }}
              placeholder={hasApiKey ? 'API key saved. Enter new key to replace.' : 'AIza...'}
              className="w-full px-3 py-2 font-hand text-base bg-background border border-border rounded focus:border-accent focus:outline-none"
              autoFocus
            />
            <button
              onClick={handleSaveKey}
              disabled={!keyInput.trim() || isSavingKey}
              className="w-full py-2.5 sketchy-border-thin font-hand text-base bg-accent text-white hover:bg-accent/90 disabled:bg-muted disabled:text-muted-foreground transition-all"
            >
              {isSavingKey ? 'Saving...' : hasApiKey ? 'Replace API Key' : 'Save API Key'}
            </button>
            {hasApiKey && (
              <p className="font-hand text-xs text-muted-foreground">
                An API key is already saved on this device.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            <AlertCircle className="text-destructive mt-0.5" size={18} />
            <p className="font-hand text-sm text-destructive/90">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ApiKeyModal;
