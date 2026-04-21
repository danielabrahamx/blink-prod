// Admin decision panel: approve + deny controls for a claim under review.

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { Claim } from '@/claims/types';
import { makeClaimsClient } from '@/claims/claimsClient';

export interface ClaimDecisionPanelProps {
  claim: Claim;
  adminWallet: string;
  adminId: string;
  onDecided?: (claim: Claim, payoutTxHash?: string) => void;
  claimsClient?: ReturnType<typeof makeClaimsClient>;
}

export function ClaimDecisionPanel({
  claim,
  adminWallet,
  adminId,
  onDecided,
  claimsClient,
}: ClaimDecisionPanelProps): JSX.Element {
  const client = claimsClient ?? makeClaimsClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payoutTx, setPayoutTx] = useState<string | null>(null);

  const isTerminal = claim.status === 'paid' || claim.status === 'denied';

  async function handleApprove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await client.approve(adminWallet, adminId, claim.id);
      if (res.payout?.error) {
        setError(`Payout failed: ${res.payout.error}`);
      }
      if (res.payout?.txHash) setPayoutTx(res.payout.txHash);
      if (res.claim) onDecided?.(res.claim, res.payout?.txHash);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeny(): Promise<void> {
    if (!reason.trim()) {
      setError('Reason is required to deny.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await client.deny(adminWallet, adminId, claim.id, reason.trim());
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.claim) onDecided?.(res.claim);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card aria-label="Claim decision">
      <CardHeader>
        <CardTitle>Decision</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isTerminal ? (
          <p className="text-sm text-muted-foreground">
            This claim is in a terminal state ({claim.status}).
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={handleApprove}
                disabled={busy}
                aria-busy={busy}
              >
                Approve and pay out
              </Button>
            </div>
            <div>
              <Label htmlFor="denyReason">Deny reason</Label>
              <Textarea
                id="denyReason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this claim is denied (required)."
              />
              <Button
                type="button"
                variant="destructive"
                className="mt-2"
                onClick={handleDeny}
                disabled={busy || !reason.trim()}
              >
                Deny
              </Button>
            </div>
          </>
        )}

        {payoutTx && (
          <p className="text-sm" data-testid="payout-tx">
            Paid. Tx:{' '}
            <a
              href={`https://explorer.arc.network/tx/${payoutTx}`}
              className="underline"
              target="_blank"
              rel="noreferrer"
            >
              {payoutTx}
            </a>
          </p>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
