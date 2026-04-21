import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClaimStatus } from '../ClaimStatus';
import type { Claim, SettlementReceipt } from '../types';

function buildClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'clm_test',
    policyId: 'pol_1',
    policyholderWallet: '0xabc',
    claimType: 'damage',
    amountClaimedUsdc: 500,
    incidentDescription: 'dropped laptop',
    incidentDate: 1_700_000_000_000,
    evidence: [],
    policeReportRef: null,
    deviceFingerprintSubmitted: 'fp',
    devicePubkeySubmitted: null,
    status: 'submitted',
    fraudFlags: [],
    submittedAt: 1_700_000_000_000,
    reviewByAt: 1_700_086_400_000,
    payoutByAt: 1_700_259_200_000,
    ...overrides,
  };
}

describe('ClaimStatus', () => {
  it('renders submitted badge + SLA expectations', () => {
    render(<ClaimStatus claim={buildClaim({ status: 'submitted' })} />);
    expect(screen.getByTestId('claim-status-badge')).toHaveTextContent('Submitted');
    expect(screen.getByText(/Expected review by/)).toBeInTheDocument();
  });

  it('renders under_review badge + SLA expectations', () => {
    render(<ClaimStatus claim={buildClaim({ status: 'under_review' })} />);
    expect(screen.getByTestId('claim-status-badge')).toHaveTextContent('Under Review');
  });

  it('renders approved badge (no denial, no receipt)', () => {
    render(<ClaimStatus claim={buildClaim({ status: 'approved' })} />);
    expect(screen.getByTestId('claim-status-badge')).toHaveTextContent('Approved');
  });

  it('renders denied badge with reason + detail', () => {
    render(
      <ClaimStatus
        claim={buildClaim({
          status: 'denied',
          denialReason: 'amount_exceeds_cap',
          denialDetail: 'claim was 2x the cap',
        })}
      />,
    );
    expect(screen.getByTestId('claim-status-badge')).toHaveTextContent('Denied');
    expect(screen.getByText(/amount exceeds cap/)).toBeInTheDocument();
    expect(screen.getByText('claim was 2x the cap')).toBeInTheDocument();
  });

  it('renders paid badge with tx link', () => {
    const receipt: SettlementReceipt = {
      claimId: 'clm_test',
      recipientAddress: '0xabc',
      amountUsdc: 500,
      txHash: '0xdeadbeef',
      network: 'arc-testnet',
      paidAt: 1_700_000_000_000,
    };
    render(
      <ClaimStatus
        claim={buildClaim({ status: 'paid', payoutTxHash: '0xdeadbeef' })}
        receipt={receipt}
      />,
    );
    expect(screen.getByTestId('claim-status-badge')).toHaveTextContent('Paid');
    const link = screen.getByRole('link', { name: /0xdeadbeef/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('0xdeadbeef'));
  });

  it('surfaces fraud flags when present', () => {
    render(
      <ClaimStatus
        claim={buildClaim({ fraudFlags: ['age_vs_amount', 'device_mismatch'] })}
      />,
    );
    expect(screen.getByText(/age_vs_amount/)).toBeInTheDocument();
    expect(screen.getByText(/device_mismatch/)).toBeInTheDocument();
  });
});
