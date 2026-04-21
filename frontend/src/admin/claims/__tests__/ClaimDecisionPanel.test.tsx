import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaimDecisionPanel } from '../ClaimDecisionPanel';
import type { Claim } from '@/claims/types';

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'clm_x',
    policyId: 'pol_1',
    policyholderWallet: '0xabc',
    claimType: 'damage',
    amountClaimedUsdc: 300,
    incidentDescription: '',
    incidentDate: 1,
    evidence: [],
    policeReportRef: null,
    deviceFingerprintSubmitted: 'fp',
    devicePubkeySubmitted: null,
    status: 'under_review',
    fraudFlags: [],
    submittedAt: 1,
    reviewByAt: 10,
    payoutByAt: 50,
    ...overrides,
  };
}

function makeClient() {
  return {
    approve: vi.fn().mockResolvedValue({
      claim: { ...claim(), status: 'paid' },
      payout: { txHash: '0xhash1' },
    }),
    deny: vi.fn().mockResolvedValue({ claim: { ...claim(), status: 'denied' } }),
  } as unknown as ReturnType<typeof import('@/claims/claimsClient').makeClaimsClient>;
}

describe('ClaimDecisionPanel', () => {
  it('approve path calls client and surfaces tx hash', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const onDecided = vi.fn();
    render(
      <ClaimDecisionPanel
        claim={claim()}
        adminWallet="0xadmin"
        adminId="admin-1"
        onDecided={onDecided}
        claimsClient={client}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Approve and pay out/i }));
    await waitFor(() => expect(screen.getByTestId('payout-tx')).toBeInTheDocument());
    expect(onDecided).toHaveBeenCalled();
    expect((client.approve as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      '0xadmin',
      'admin-1',
      'clm_x',
    ]);
  });

  it('deny path requires a reason before the button is enabled', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const onDecided = vi.fn();
    render(
      <ClaimDecisionPanel
        claim={claim()}
        adminWallet="0xadmin"
        adminId="admin-1"
        onDecided={onDecided}
        claimsClient={client}
      />,
    );
    const denyButton = screen.getByRole('button', { name: /^Deny$/ });
    expect(denyButton).toBeDisabled();
    await user.type(screen.getByLabelText(/Deny reason/i), 'evidence insufficient');
    expect(denyButton).toBeEnabled();
    await user.click(denyButton);
    await waitFor(() => expect(onDecided).toHaveBeenCalled());
    expect((client.deny as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      '0xadmin',
      'admin-1',
      'clm_x',
      'evidence insufficient',
    ]);
  });

  it('shows a terminal state message when claim is paid', () => {
    render(
      <ClaimDecisionPanel
        claim={claim({ status: 'paid' })}
        adminWallet="0xadmin"
        adminId="admin-1"
        claimsClient={makeClient()}
      />,
    );
    expect(screen.getByText(/terminal state/i)).toBeInTheDocument();
  });
});
