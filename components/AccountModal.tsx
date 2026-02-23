import React, { useEffect, useState } from 'react';
import { X, UserCircle2, LogOut, Trash2, AlertTriangle, ExternalLink } from 'lucide-react';

interface AccountModalProps {
  isOpen: boolean;
  isAuthenticated: boolean;
  isDeleting: boolean;
  privacyPolicyUrl: string | null;
  supportEmail: string | null;
  onClose: () => void;
  onSignOut: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
}

const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  isAuthenticated,
  isDeleting,
  privacyPolicyUrl,
  supportEmail,
  onClose,
  onSignOut,
  onDeleteAccount,
}) => {
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setDeleteConfirmText('');
      setError(null);
      setIsSigningOut(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSignOut = async () => {
    setError(null);
    setIsSigningOut(true);
    try {
      await onSignOut();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Sign out failed. Please try again.');
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;
    setError(null);
    try {
      await onDeleteAccount();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Account deletion failed. Please try again.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-background/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-modal-title"
    >
      <div
        className="bg-card w-full md:max-w-lg md:sketchy-border rounded-t-3xl md:rounded-none p-6 md:p-8 relative shadow-2xl animate-sketch-in max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-muted/20 hover:bg-muted/50 rounded-full transition-colors text-foreground"
          aria-label="Close account settings"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-accent/10 rounded-lg">
            <UserCircle2 className="text-accent" size={28} />
          </div>
          <div>
            <h2 id="account-modal-title" className="font-sketch text-3xl text-foreground">Account</h2>
            <p className="font-hand text-sm text-muted-foreground">
              Manage sign-in and personal data
            </p>
          </div>
        </div>

        {!isAuthenticated ? (
          <div className="p-3 bg-muted/30 rounded-lg">
            <p className="font-hand text-sm text-muted-foreground">
              You are not signed in.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              onClick={handleSignOut}
              disabled={isSigningOut || isDeleting}
              className="w-full p-3 sketchy-border-thin hover:bg-muted/30 transition-all flex items-center justify-center gap-2 font-hand text-base"
            >
              <LogOut size={16} />
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>

            <div className="border border-destructive/25 bg-destructive/5 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-2 text-destructive">
                <AlertTriangle size={16} className="mt-0.5" />
                <div className="font-hand text-sm">
                  Delete your account and all GIF credit data from this app backend.
                  This action cannot be undone.
                </div>
              </div>

              <p className="font-hand text-xs text-muted-foreground">
                Type <strong>DELETE</strong> to confirm:
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded font-mono text-sm focus:outline-none focus:border-accent"
                placeholder="DELETE"
                autoComplete="off"
              />
              <button
                onClick={handleDelete}
                disabled={isDeleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                className="w-full p-3 sketchy-border-thin bg-destructive text-white hover:bg-destructive/90 disabled:bg-muted disabled:text-muted-foreground transition-all flex items-center justify-center gap-2 font-hand text-base"
              >
                <Trash2 size={16} />
                {isDeleting ? 'Deleting account...' : 'Delete account'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 space-y-3">
          <div className="p-3 bg-muted/20 rounded-lg space-y-2">
            <p className="font-hand text-sm text-foreground/80">
              Your prompts and generated images are processed by cloud services in credit mode.
            </p>
            {privacyPolicyUrl ? (
              <a
                href={privacyPolicyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-hand text-sm text-accent underline"
              >
                Privacy policy <ExternalLink size={12} />
              </a>
            ) : (
              <p className="font-hand text-xs text-destructive/80">
                Privacy policy URL is not configured yet.
              </p>
            )}
            {supportEmail && (
              <p className="font-hand text-xs text-muted-foreground">
                Support: {supportEmail}
              </p>
            )}
          </div>
        </div>

        {error && (
          <div
            className="mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg"
            role="alert"
            aria-live="assertive"
          >
            <p className="font-hand text-sm text-destructive/90">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountModal;
