// Admin queue for pending claims. Sorted by SLA (reviewByAt ascending).

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Claim } from '@/claims/types';
import { STATUS_LABEL } from '@/claims/types';
import { makeClaimsClient } from '@/claims/claimsClient';

export interface ClaimsQueueProps {
  adminWallet: string;
  adminId: string;
  onInspect?: (claimId: string) => void;
  claims?: Claim[];
  claimsClient?: ReturnType<typeof makeClaimsClient>;
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
    default:
      return 'outline';
  }
}

export function ClaimsQueue({
  adminWallet,
  adminId,
  onInspect,
  claims: initial,
  claimsClient,
}: ClaimsQueueProps): JSX.Element {
  const [claims, setClaims] = useState<Claim[] | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    const client = claimsClient ?? makeClaimsClient();
    let cancelled = false;
    client
      .adminQueue(adminWallet, adminId)
      .then((list) => {
        if (!cancelled) setClaims(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [adminWallet, adminId, initial, claimsClient]);

  if (error) {
    return (
      <Card aria-label="Claims queue error">
        <CardContent className="p-6 text-destructive" role="alert">
          {error}
        </CardContent>
      </Card>
    );
  }

  if (!claims) {
    return (
      <Card aria-label="Claims queue loading">
        <CardContent className="p-6 text-muted-foreground">Loading...</CardContent>
      </Card>
    );
  }

  if (claims.length === 0) {
    return (
      <Card aria-label="Claims queue empty">
        <CardContent className="p-6 text-muted-foreground">
          No claims awaiting review.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card aria-label="Claims queue">
      <CardHeader>
        <CardTitle>Claims queue ({claims.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Review SLA</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Policy</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {claims.map((c) => (
              <TableRow key={c.id} data-testid={`queue-row-${c.id}`}>
                <TableCell>{new Date(c.reviewByAt).toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(c.status)}>
                    {STATUS_LABEL[c.status]}
                  </Badge>
                </TableCell>
                <TableCell>{c.claimType}</TableCell>
                <TableCell>${c.amountClaimedUsdc.toFixed(2)}</TableCell>
                <TableCell className="font-mono text-xs">{c.policyId}</TableCell>
                <TableCell>
                  {c.fraudFlags.length > 0 ? (
                    <span className="text-amber-600 text-xs">
                      {c.fraudFlags.length}
                    </span>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => onInspect?.(c.id)}
                  >
                    Inspect
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
