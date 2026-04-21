// User-facing status page for a single claim.

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Claim, SettlementReceipt } from './types';
import { STATUS_LABEL } from './types';

export interface ClaimStatusProps {
  claim: Claim;
  receipt?: SettlementReceipt | null;
}

function statusVariant(status: Claim['status']):
  'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'paid':
    case 'approved':
      return 'default';
    case 'denied':
      return 'destructive';
    case 'under_review':
      return 'secondary';
    case 'submitted':
    default:
      return 'outline';
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function ClaimStatus({ claim, receipt }: ClaimStatusProps): JSX.Element {
  const statusLabel = STATUS_LABEL[claim.status];
  const variant = statusVariant(claim.status);

  return (
    <Card aria-label={`Claim ${claim.id} status`}>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Claim {claim.id}</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Submitted {formatDate(claim.submittedAt)}
          </p>
        </div>
        <Badge variant={variant} data-testid="claim-status-badge">
          {statusLabel}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Amount claimed</p>
            <p className="font-medium">${claim.amountClaimedUsdc.toFixed(2)} USDC</p>
          </div>
          <div>
            <p className="text-muted-foreground">Incident date</p>
            <p className="font-medium">{formatDate(claim.incidentDate)}</p>
          </div>
        </div>

        {(claim.status === 'submitted' || claim.status === 'under_review') && (
          <div className="rounded-md border p-3 text-sm">
            <p>
              Expected review by <strong>{formatDate(claim.reviewByAt)}</strong>
            </p>
            <p>
              Expected payout (if approved) by <strong>{formatDate(claim.payoutByAt)}</strong>
            </p>
          </div>
        )}

        {claim.status === 'denied' && (
          <div className="rounded-md border border-destructive p-3 text-sm" role="alert">
            <p className="font-medium text-destructive">Claim denied</p>
            {claim.denialReason && (
              <p className="text-muted-foreground mt-1">
                Reason: {claim.denialReason.replace(/_/g, ' ')}
              </p>
            )}
            {claim.denialDetail && (
              <p className="text-muted-foreground mt-1">{claim.denialDetail}</p>
            )}
          </div>
        )}

        {claim.status === 'paid' && receipt && (
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">Paid</p>
            <p className="text-muted-foreground mt-1">
              Transaction:{' '}
              <a
                href={`https://explorer.arc.network/tx/${receipt.txHash}`}
                className="underline"
                target="_blank"
                rel="noreferrer"
              >
                {receipt.txHash}
              </a>
            </p>
            <p className="text-muted-foreground">
              Network: {receipt.network} — block {receipt.blockNumber ?? '—'}
            </p>
          </div>
        )}

        {claim.fraudFlags.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Admin-side review flags: {claim.fraudFlags.join(', ')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
