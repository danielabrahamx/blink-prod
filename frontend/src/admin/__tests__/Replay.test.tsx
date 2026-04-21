import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import Replay from '../Replay';
import { fixtureReplay } from './fixtures';

function renderReplay() {
  return render(
    <MemoryRouter initialEntries={['/admin/replay']}>
      <Routes>
        <Route element={<Outlet context={{ wallet: '0xabc' }} />}>
          <Route path="/admin/replay" element={<Replay />} />
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

describe('Replay', () => {
  it('renders the configuration form and no result section', () => {
    renderReplay();
    expect(screen.getByText(/Replay Configuration/i)).toBeInTheDocument();
    expect(screen.queryByTestId('replay-result')).toBeNull();
  });

  it('submits a typed request body and renders the SVG chart + table', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(fixtureReplay), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderReplay();

    fireEvent.change(screen.getByLabelText(/Policy ID/i), {
      target: { value: 'pol_test_0001' },
    });
    fireEvent.change(screen.getByLabelText(/Window Start/i), {
      target: { value: '2026-04-21T09:00' },
    });
    fireEvent.change(screen.getByLabelText(/Window End/i), {
      target: { value: '2026-04-21T10:00' },
    });
    // Model Version already defaults to v1.0.0.

    fireEvent.click(screen.getByTestId('replay-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('replay-result')).toBeInTheDocument();
    });

    // Verify request shape.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/admin\/replay$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      policy_id: 'pol_test_0001',
      window_start: '2026-04-21T09:00',
      window_end: '2026-04-21T10:00',
      model_version: 'v1.0.0',
    });

    // SVG chart renders with one polyline per series.
    expect(screen.getByTestId('replay-chart-svg')).toBeInTheDocument();
    expect(screen.getByTestId('replay-chart-replay')).toBeInTheDocument();
    expect(screen.getByTestId('replay-chart-actual')).toBeInTheDocument();
  });

  it('shows empty state when the series is empty', async () => {
    const emptyReplay = { ...fixtureReplay, minute_series: [], total_accrued_delta_usdc: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(emptyReplay), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
    renderReplay();
    fireEvent.change(screen.getByLabelText(/Policy ID/i), { target: { value: 'p' } });
    fireEvent.change(screen.getByLabelText(/Window Start/i), { target: { value: '2026-04-21T09:00' } });
    fireEvent.change(screen.getByLabelText(/Window End/i), { target: { value: '2026-04-21T09:01' } });
    fireEvent.click(screen.getByTestId('replay-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('replay-chart-empty')).toBeInTheDocument();
    });
  });

  it('renders an error message when the API returns 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('invalid_time_window', { status: 400 })),
      ),
    );
    renderReplay();
    fireEvent.change(screen.getByLabelText(/Policy ID/i), { target: { value: 'p' } });
    fireEvent.change(screen.getByLabelText(/Window Start/i), { target: { value: '2026-04-21T10:00' } });
    fireEvent.change(screen.getByLabelText(/Window End/i), { target: { value: '2026-04-21T09:00' } });
    fireEvent.click(screen.getByTestId('replay-submit'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/HTTP 400/);
    });
  });
});
