import React, { useState } from 'react';
import { X, Key, AlertCircle } from 'lucide-react';
import { setApiKey, ApiKeyError } from '../services/apiKeyStorage';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeySaved: () => void;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onKeySaved }) => {
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    setError(null);
    setIsSubmitting(true);

    try {
      setApiKey(keyInput);
      setKeyInput('');
      onKeySaved();
      onClose();
    } catch (e) {
      if (e instanceof ApiKeyError) {
        setError(e.message);
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && keyInput.trim()) {
      handleSave();
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/60 backdrop-blur-sm animate-fade-in" 
      onClick={(e) => {
        // Allow closing only if a key was previously set (so users can't skip initial setup)
        if (e.target === e.currentTarget) {
          const hasKey = localStorage.getItem('gemini_api_key');
          if (hasKey) onClose();
        }
      }}
    >
      <div 
        className="bg-card sketchy-border w-full max-w-lg p-8 relative shadow-2xl animate-sketch-in" 
        onClick={e => e.stopPropagation()}
      >
        {/* Close Button - only show if user already has a key set */}
        {localStorage.getItem('gemini_api_key') && (
          <button 
            onClick={onClose} 
            className="absolute top-4 right-4 p-2 bg-muted/20 hover:bg-muted/50 rounded-full transition-colors text-foreground"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        )}

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-accent/10 rounded-lg">
            <Key className="text-accent" size={28} />
          </div>
          <h2 className="font-sketch text-3xl text-foreground">API Key Required</h2>
        </div>

        <div className="space-y-4 mb-6">
          <p className="font-hand text-lg text-foreground/80">
            This app uses Google's Gemini API to generate SVG graphics. 
            You'll need your own API key to continue.
          </p>
          
          <div className="bg-accent/5 border border-accent/20 rounded-lg p-4">
            <p className="font-hand text-base text-foreground/70 mb-2">
              <strong>How to get your key:</strong>
            </p>
            <ol className="font-hand text-sm text-foreground/70 space-y-1 list-decimal list-inside">
              <li>Visit <a href="https://ai.google.dev" target="_blank" rel="noopener noreferrer" className="text-accent underline hover:text-accent/80">ai.google.dev</a></li>
              <li>Sign in with your Google account</li>
              <li>Create or select a project</li>
              <li>Generate an API key</li>
            </ol>
          </div>

          <div>
            <label htmlFor="api-key-input" className="font-hand text-base text-foreground/80 mb-2 block">
              Enter your Gemini API Key:
            </label>
            <input
              id="api-key-input"
              type="password"
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value);
                setError(null);
              }}
              onKeyPress={handleKeyPress}
              placeholder="AIza..."
              className="w-full px-4 py-3 font-hand text-lg bg-background border-2 border-border rounded-lg focus:border-accent focus:outline-none transition-colors"
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-3">
              <AlertCircle className="text-destructive mt-0.5" size={18} />
              <p className="font-hand text-sm text-destructive/90">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={!keyInput.trim() || isSubmitting}
            className="flex-1 py-3 sketchy-border-thin font-sketch text-xl bg-accent text-white hover:bg-accent/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed transition-all"
          >
            {isSubmitting ? 'Saving...' : 'Save Key'}
          </button>
        </div>

        <p className="font-hand text-xs text-muted-foreground mt-4 text-center">
          🔒 Your API key is stored locally in your browser and never sent to our servers.
        </p>
      </div>
    </div>
  );
};

export default ApiKeyModal;
