import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminLayout from '../AdminLayout';

function renderLayout(wallet: string | null) {
  return render(
    <MemoryRouter initialEntries={['/admin/metrics']}>
      <Routes>
        <Route path="/admin" element={<AdminLayout walletAddress={wallet} />}>
          <Route
            path="metrics"
            element={<div data-testid="child-metrics">child</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminLayout', () => {
  it('shows the wallet-required gate when no wallet is injected', () => {
    renderLayout(null);
    expect(screen.getByText(/Wallet required/i)).toBeInTheDocument();
    expect(screen.queryByTestId('child-metrics')).toBeNull();
  });

  it('shows a verifying gate while role resolves, then admin content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              wallet_addr: '0xabc',
              role: 'admin',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ),
    );
    renderLayout('0xabc');
    // Initial gate message appears before fetch resolves.
    expect(
      screen.getByText(/Verifying role|Wallet required/i),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('child-metrics')).toBeInTheDocument();
    });
    expect(screen.getByTestId('admin-wallet')).toHaveTextContent(/0xabc/);
  });

  it('shows access-denied on 403 from /admin/role', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('denied', { status: 403 })),
      ),
    );
    renderLayout('0xbaddead');
    await waitFor(() => {
      expect(screen.getByText(/Access denied/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('child-metrics')).toBeNull();
  });

  it('shows an error gate when the role lookup fails with a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    );
    renderLayout('0xabc');
    await waitFor(() => {
      expect(screen.getByText(/Role lookup failed/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/network down/i)).toBeInTheDocument();
  });
});
