import React, { useEffect, useRef, useState } from 'react';
import { Coins } from 'lucide-react';
import { getLocalBalance, subscribeToBalance, formatCredits } from '../services/tokenManager';

interface TokenDisplayProps {
  onClick: () => void;
}

const TokenDisplay: React.FC<TokenDisplayProps> = ({ onClick }) => {
  const [balance, setBalance] = useState<number>(getLocalBalance() ?? 0);
  const [animate, setAnimate] = useState(false);
  const animationTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToBalance((newBalance) => {
      setBalance(newBalance);
      setAnimate(true);
      if (animationTimeoutRef.current !== null) {
        window.clearTimeout(animationTimeoutRef.current);
      }
      animationTimeoutRef.current = window.setTimeout(() => {
        setAnimate(false);
        animationTimeoutRef.current = null;
      }, 600);
    });

    return () => {
      unsubscribe();
      if (animationTimeoutRef.current !== null) {
        window.clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 sketchy-border-thin bg-accent/10 hover:bg-accent/20 transition-all text-foreground font-hand text-base ${animate ? 'scale-110' : 'scale-100'}`}
      title="GIF Credits balance - Click to buy more"
      style={{ transition: 'transform 0.3s ease' }}
    >
      <Coins size={16} className="text-accent" />
      <span className="font-sketch text-lg">{formatCredits(balance, { decimals: 2 })}</span>
    </button>
  );
};

export default TokenDisplay;
