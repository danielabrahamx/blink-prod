import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PolicyInspector from '../PolicyInspector';
import { fixturePolicy } from './fixtures';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          element={
            // Provide the outlet context the real AdminLayout would supply.
            <OutletStub />
          }
        >
          <Route path="/admin/policy" element={<PolicyInspector />} />
          <Route path="/admin/policy/:id" element={<PolicyInspector />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

import { Outlet } from 'react-router-dom';
function OutletStub() {
  return <Outlet context={{ wallet: '0xabc' }} />;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('PolicyInspector', () => {
  it('renders the pick-a-policy empty state without an :id', () => {
    renderAt('/admin/policy');
    expect(screen.getByText(/No policy selected/i)).toBeInTheDocument();
  });

  it('renders every section when the API returns a populated policy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(fixturePolicy), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
    renderAt('/admin/policy/pol_test_0001');
    await waitFor(() => {
      expect(screen.getByTestId('policy-inspector')).toBeInTheDocument();
    });
    for (const tid of [
      'policy-header',
      'policy-breakdown',
      'policy-signals',
      'policy-features',
      'policy-accrual',
      'policy-escrow',
      'policy-settlement',
      'policy-claims',
      'policy-fsm',
    ]) {
      expect(screen.getByTestId(tid)).toBeInTheDocument();
    }
    const bar = screen.getByTestId('escrow-consumption-bar') as HTMLElement;
    expect(bar.style.width).toBe('25%');
  });

  it('renders empty-state labels when sections are empty', async () => {
    const emptyPolicy = {
      ...fixturePolicy,
      signal_timeline_24h: [],
      feature_history: [],
      accrual_ledger: [],
      settlement_receipts: [],
      claims: [],
      fsm_log: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(emptyPolicy), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
    renderAt('/admin/policy/pol_empty');
    await waitFor(() => {
      expect(screen.getByTestId('policy-inspector')).toBeInTheDocument();
    });
    expect(screen.getByText(/No signals in the last 24 hours\./i)).toBeInTheDocument();
    expect(screen.getByText(/No settlements yet\./i)).toBeInTheDocument();
    expect(screen.getByText(/No claims filed\./i)).toBeInTheDocument();
    expect(screen.getByText(/Ledger empty\./i)).toBeInTheDocument();
  });

  it('renders a destructive error state when the API returns 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('db_down', { status: 500 })),
      ),
    );
    renderAt('/admin/policy/pol_test_0001');
    await waitFor(() => {
      expect(screen.getByText(/Lookup failed/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/db_down/i)).toBeInTheDocument();
  });
});
