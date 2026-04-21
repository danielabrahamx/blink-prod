// AdminEntry is the host page that wires the connected wallet address into
// AdminLayout. Until a global wallet provider exists, we read the address
// from localStorage (the main InsuracleDashboard writes it there after SIWE).
// Wave 3 will unify on a shared WalletProvider.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/admin';

const ADMIN_WALLET_KEY = 'blink.admin.wallet';

export default function AdminEntry() {
  const [wallet, setWallet] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ADMIN_WALLET_KEY);
      if (saved) setWallet(saved);
    } catch {
      // no-op: storage may be blocked
    }
  }, []);

  return (
    <AdminLayout
      walletAddress={wallet}
      onDisconnect={() => {
        try {
          window.localStorage.removeItem(ADMIN_WALLET_KEY);
        } catch {
          // no-op
        }
        setWallet(null);
        navigate('/');
      }}
    />
  );
}
