import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import MetricsPanel from '../MetricsPanel';
import { fixtureMetrics } from './fixtures';

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/admin/metrics']}>
      <Routes>
        <Route element={<Outlet context={{ wallet: '0xabc' }} />}>
          <Route path="/admin/metrics" element={<MetricsPanel />} />
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

describe('MetricsPanel', () => {
  it('renders a loading affordance before the fetch resolves', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})), // never resolves
    );
    renderPanel();
    expect(screen.getByTestId('metrics-panel')).toBeInTheDocument();
    const refresh = screen.getByTestId('metrics-refresh') as HTMLButtonElement;
    expect(refresh).toBeDisabled();
    expect(refresh.textContent).toMatch(/Refreshing/i);
  });

  it('renders every metric row when data arrives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(fixtureMetrics), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/Active policies/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Avg multiplier/i)).toBeInTheDocument();
    expect(screen.getByText(/Ingest latency p50/i)).toBeInTheDocument();
    expect(screen.getByText(/Ingest latency p95/i)).toBeInTheDocument();
    expect(screen.getByText(/Ingest latency p99/i)).toBeInTheDocument();
    expect(screen.getByText(/Claim queue depth/i)).toBeInTheDocument();
    expect(screen.getByText(/Authorization consumption/i)).toBeInTheDocument();
    expect(screen.getByText('1.080x')).toBeInTheDocument();
    expect(screen.getByText('42ms')).toBeInTheDocument();
  });

  it('surfaces an error alert on 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('db_down', { status: 500 }))),
    );
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/HTTP 500/);
    });
  });
});
