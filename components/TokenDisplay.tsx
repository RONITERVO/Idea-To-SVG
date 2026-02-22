import React, { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { getLocalBalance, subscribeToBalance, formatTokens } from '../services/tokenManager';

interface TokenDisplayProps {
  onClick: () => void;
}

const TokenDisplay: React.FC<TokenDisplayProps> = ({ onClick }) => {
  const [balance, setBalance] = useState(getLocalBalance());
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToBalance((newBalance) => {
      setBalance(newBalance);
      setAnimate(true);
      setTimeout(() => setAnimate(false), 600);
    });
    return unsubscribe;
  }, []);

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 sketchy-border-thin bg-accent/10 hover:bg-accent/20 transition-all text-foreground font-hand text-base ${animate ? 'scale-110' : 'scale-100'}`}
      title="Token Balance - Click to buy more"
      style={{ transition: 'transform 0.3s ease' }}
    >
      <Coins size={16} className="text-accent" />
      <span className="font-sketch text-lg">{formatTokens(balance)}</span>
    </button>
  );
};

export default TokenDisplay;
