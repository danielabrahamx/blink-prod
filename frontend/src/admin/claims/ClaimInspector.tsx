// Admin inspector drawer for a single claim.

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Claim } from '@/claims/types';
import { FRAUD_LABEL, STATUS_LABEL } from '@/claims/types';

export interface ClaimInspectorProps {
  claim: Claim;
  policy?: {
    id: string;
    payoutCapUsdc?: number;
    deviceFingerprintHash?: string | null;
  } | null;
  signalHistory?: Array<{ ts: number; multiplier: number; maxMultiplier: number }>;
}

export function ClaimInspector({
  claim,
  policy,
  signalHistory = [],
}: ClaimInspectorProps): JSX.Element {
  const fingerprintMatch =
    policy?.deviceFingerprintHash && claim.deviceFingerprintSubmitted
      ? policy.deviceFingerprintHash === claim.deviceFingerprintSubmitted
      : null;

  return (
    <Card aria-label={`Inspector for ${claim.id}`}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Claim {claim.id}</span>
          <Badge data-testid="inspector-status">{STATUS_LABEL[claim.status]}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <section>
          <h3 className="font-medium mb-2">Summary</h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-muted-foreground">Type</dt>
            <dd>{claim.claimType}</dd>
            <dt className="text-muted-foreground">Amount</dt>
            <dd>${claim.amountClaimedUsdc.toFixed(2)} USDC</dd>
            <dt className="text-muted-foreground">Incident</dt>
            <dd>{new Date(claim.incidentDate).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Submitted</dt>
            <dd>{new Date(claim.submittedAt).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Review SLA</dt>
            <dd>{new Date(claim.reviewByAt).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Payout SLA</dt>
            <dd>{new Date(claim.payoutByAt).toLocaleString()}</dd>
          </dl>
        </section>

        <section>
          <h3 className="font-medium mb-2">Incident narrative</h3>
          <p className="text-sm whitespace-pre-wrap">{claim.incidentDescription}</p>
        </section>

        {claim.evidence.length > 0 && (
          <section>
            <h3 className="font-medium mb-2">Evidence</h3>
            <ul className="text-sm list-disc list-inside">
              {claim.evidence.map((e) => (
                <li key={e.storageUri}>
                  {e.filename} ({e.mimetype}, {Math.round(e.sizeBytes / 1024)} KB)
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="font-medium mb-2">Device fingerprint</h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-muted-foreground">Bound</dt>
            <dd className="font-mono text-xs">
              {policy?.deviceFingerprintHash ?? 'n/a'}
            </dd>
            <dt className="text-muted-foreground">Submitted</dt>
            <dd className="font-mono text-xs">
              {claim.deviceFingerprintSubmitted}
            </dd>
            <dt className="text-muted-foreground">Match</dt>
            <dd>
              {fingerprintMatch === null
                ? 'n/a'
                : fingerprintMatch
                  ? 'Yes'
                  : 'No'}
            </dd>
          </dl>
        </section>

        <section>
          <h3 className="font-medium mb-2">Fraud flags</h3>
          {claim.fraudFlags.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {claim.fraudFlags.map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <Badge variant="secondary">{f}</Badge>
                  <span className="text-muted-foreground">{FRAUD_LABEL[f]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {signalHistory.length > 0 && (
          <section>
            <h3 className="font-medium mb-2">
              Signals leading up to incident ({signalHistory.length})
            </h3>
            <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
              {signalHistory.slice(-50).map((s) => (
                <li key={s.ts}>
                  {new Date(s.ts).toLocaleString()} — multiplier {s.multiplier}/{s.maxMultiplier}
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
