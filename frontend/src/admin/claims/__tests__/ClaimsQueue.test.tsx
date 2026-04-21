import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaimsQueue } from '../ClaimsQueue';
import type { Claim } from '@/claims/types';

function claim(overrides: Partial<Claim>): Claim {
  return {
    id: overrides.id ?? 'clm_x',
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
    status: 'submitted',
    fraudFlags: [],
    submittedAt: 1,
    reviewByAt: overrides.reviewByAt ?? 10,
    payoutByAt: 50,
    ...overrides,
  };
}

describe('ClaimsQueue', () => {
  it('shows empty state', () => {
    render(<ClaimsQueue adminWallet="0xadmin" adminId="admin-1" claims={[]} />);
    expect(screen.getByText(/No claims awaiting review/)).toBeInTheDocument();
  });

  it('renders rows sorted by reviewByAt order they were given', () => {
    const claims = [
      claim({ id: 'clm_a', reviewByAt: 5 }),
      claim({ id: 'clm_b', reviewByAt: 10 }),
    ];
    render(<ClaimsQueue adminWallet="0xadmin" adminId="admin-1" claims={claims} />);
    const rows = screen.getAllByTestId(/queue-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'queue-row-clm_a');
    expect(rows[1]).toHaveAttribute('data-testid', 'queue-row-clm_b');
  });

  it('fires onInspect with the claim id', async () => {
    const onInspect = vi.fn();
    const user = userEvent.setup();
    const claims = [claim({ id: 'clm_a' })];
    render(
      <ClaimsQueue
        adminWallet="0xadmin"
        adminId="admin-1"
        claims={claims}
        onInspect={onInspect}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Inspect/i }));
    expect(onInspect).toHaveBeenCalledWith('clm_a');
  });

  it('loads the queue from the admin client when no claims prop is supplied', async () => {
    const adminQueue = vi.fn().mockResolvedValue([claim({ id: 'clm_z' })]);
    const client = { adminQueue } as unknown as ReturnType<
      typeof import('@/claims/claimsClient').makeClaimsClient
    >;
    render(
      <ClaimsQueue adminWallet="0xadmin" adminId="admin-1" claimsClient={client} />,
    );
    await waitFor(() => expect(screen.getByTestId('queue-row-clm_z')).toBeInTheDocument());
    expect(adminQueue).toHaveBeenCalledWith('0xadmin', 'admin-1');
  });

  it('renders status badges', () => {
    const claims = [
      claim({ id: 'clm_a', status: 'submitted' }),
      claim({ id: 'clm_b', status: 'under_review' }),
    ];
    render(<ClaimsQueue adminWallet="0xadmin" adminId="admin-1" claims={claims} />);
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('Under Review')).toBeInTheDocument();
  });
});
