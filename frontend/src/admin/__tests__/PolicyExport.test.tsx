import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import PolicyExport from '../PolicyExport';

function renderExport(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={{ wallet: '0xabc' }} />}>
          <Route path="/admin/export" element={<PolicyExport />} />
          <Route path="/admin/export/:id" element={<PolicyExport />} />
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

describe('PolicyExport', () => {
  it('prefills the policy id from the route param', () => {
    renderExport('/admin/export/pol_test_0001');
    const input = screen.getByTestId('policy-export-input') as HTMLInputElement;
    expect(input.value).toBe('pol_test_0001');
  });

  it('issues a GET to /admin/export/:id and reports success', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response('policy_id,wallet_addr\npol_test,0x1', {
          status: 200,
          headers: { 'Content-Type': 'text/csv' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderExport('/admin/export/pol_test_0001');
    fireEvent.click(screen.getByTestId('policy-export-button'));
    await waitFor(() => {
      expect(screen.getByTestId('policy-export-done')).toBeInTheDocument();
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/admin\/export\/pol_test_0001$/);
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers['X-Admin-Wallet']).toBe('0xabc');
  });

  it('renders an error alert when the API returns 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))),
    );
    renderExport('/admin/export/pol_test_0001');
    fireEvent.click(screen.getByTestId('policy-export-button'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/HTTP 500/);
    });
  });

  it('disables the submit button when the policy id is empty', () => {
    renderExport('/admin/export');
    const btn = screen.getByTestId('policy-export-button') as HTMLButtonElement;
    expect(btn).toBeDisabled();
  });
});
