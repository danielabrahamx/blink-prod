import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaimSubmit } from '../ClaimSubmit';
import type { Policy } from '../types';

const policy: Policy = {
  id: 'pol_1',
  payoutCapUsdc: 1500,
  createdAt: Date.parse('2026-01-01'),
  claimWaitingUntil: Date.parse('2026-01-02'),
  active: true,
  deviceFingerprintHash: 'fp',
};

function stubClient(submitResult: {
  status?: number;
  claim?: unknown;
  error?: string;
}): ReturnType<typeof import('../claimsClient').makeClaimsClient> {
  return {
    submit: vi.fn().mockResolvedValue({
      status: submitResult.status ?? 201,
      claim: submitResult.claim,
      error: submitResult.error,
    }),
    get: vi.fn(),
    listForWallet: vi.fn(),
    adminQueue: vi.fn(),
    adminInspector: vi.fn(),
    review: vi.fn(),
    approve: vi.fn(),
    deny: vi.fn(),
  } as unknown as ReturnType<typeof import('../claimsClient').makeClaimsClient>;
}

describe('ClaimSubmit', () => {
  it('submit button is disabled when the form has no values', () => {
    render(
      <ClaimSubmit
        policy={policy}
        policyholderWallet="0xabc"
        deviceFingerprint="fp"
      />,
    );
    expect(screen.getByRole('button', { name: /Submit claim/i })).toBeDisabled();
  });

  it('submits a valid claim and calls onSubmitted', async () => {
    const onSubmitted = vi.fn();
    const client = stubClient({
      status: 201,
      claim: {
        id: 'clm_new',
        status: 'submitted',
        amountClaimedUsdc: 300,
        submittedAt: 1,
        reviewByAt: 2,
        payoutByAt: 3,
        fraudFlags: [],
        evidence: [],
      },
    });
    const user = userEvent.setup();
    render(
      <ClaimSubmit
        policy={policy}
        policyholderWallet="0xabc"
        deviceFingerprint="fp"
        onSubmitted={onSubmitted}
        claimsClient={client}
      />,
    );
    await user.type(screen.getByLabelText(/Incident date/i), '2026-04-01');
    await user.clear(screen.getByLabelText(/Amount claimed/i));
    await user.type(screen.getByLabelText(/Amount claimed/i), '300');
    await user.type(
      screen.getByLabelText(/What happened/i),
      'Laptop fell off my desk when the cat knocked it over.',
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Submit claim/i })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: /Submit claim/i }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect((client.submit as ReturnType<typeof vi.fn>).mock.calls[0][0])
      .toMatchObject({
        policyId: 'pol_1',
        claimType: 'damage',
        amountClaimedUsdc: 300,
      });
  });

  it('surfaces backend error when submit fails', async () => {
    const client = stubClient({ status: 400, error: 'invalid_submission' });
    const user = userEvent.setup();
    render(
      <ClaimSubmit
        policy={policy}
        policyholderWallet="0xabc"
        deviceFingerprint="fp"
        claimsClient={client}
      />,
    );
    await user.type(screen.getByLabelText(/Incident date/i), '2026-04-01');
    await user.clear(screen.getByLabelText(/Amount claimed/i));
    await user.type(screen.getByLabelText(/Amount claimed/i), '300');
    await user.type(screen.getByLabelText(/What happened/i), 'details here');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Submit claim/i })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: /Submit claim/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('invalid_submission'),
    );
  });

  it('rejects an amount that exceeds the policy cap', async () => {
    const user = userEvent.setup();
    render(
      <ClaimSubmit
        policy={policy}
        policyholderWallet="0xabc"
        deviceFingerprint="fp"
      />,
    );
    await user.type(screen.getByLabelText(/Incident date/i), '2026-04-01');
    await user.clear(screen.getByLabelText(/Amount claimed/i));
    await user.type(screen.getByLabelText(/Amount claimed/i), '5000');
    await user.type(screen.getByLabelText(/What happened/i), 'too much');
    await waitFor(() =>
      expect(screen.getByText(/Cap is \$1500 USDC/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Submit claim/i })).toBeDisabled();
  });
});
