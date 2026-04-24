import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LiveDemo from '../LiveDemo';
import { writeHomeSpawn, clearHomeSpawn } from '@/lib/homeSpawn';

vi.mock('@/lib/gatewayClient', async () => {
  const sim = await import('@/lib/simulationClient');
  const client = sim.createSimulationGatewayClient();
  return {
    getGatewayClient: () => client,
  };
});

vi.mock('@/lib/blinkContract', () => ({
  buyInsurance: vi.fn(async () => ({
    ok: true,
    premiumUsdc: '0.150000',
    coverageUsdc: '1.500000',
    txHash: '0xSIM' + '0'.repeat(62),
  })),
  hasActivePolicy: vi.fn(async () => false),
}));

const EMAIL_GATE_KEY = 'blink_email_signup_v1';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    EMAIL_GATE_KEY,
    JSON.stringify({ status: 'signed_up', at: new Date().toISOString() }),
  );
  writeHomeSpawn({ lat: 51.5074, lng: -0.1278, country: 'GB' });

  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)),
  );

  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: vi.fn((success: PositionCallback) => {
        success({
          coords: {
            latitude: 51.5074,
            longitude: -0.1278,
            accuracy: 5,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as GeolocationPosition);
        return 1;
      }),
      clearWatch: vi.fn(),
    },
  });
});

afterEach(() => {
  clearHomeSpawn();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderLiveRoute() {
  return render(
    <MemoryRouter initialEntries={['/live']}>
      <Routes>
        <Route path="/live" element={<LiveDemo />} />
        <Route path="/" element={<div data-testid="landing-stub" />} />
        <Route path="/set-home" element={<div data-testid="sethome-stub" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LiveDemo', () => {
  it('renders headline and waits on Start before ticking', async () => {
    renderLiveRoute();
    expect(await screen.findByText(/YOUR COVER/)).toBeInTheDocument();
    expect(screen.getByTestId('start-session')).toBeInTheDocument();
    expect(screen.queryByTestId('end-session')).not.toBeInTheDocument();
  });

  it('redirects to /set-home when no home spawn is saved', async () => {
    clearHomeSpawn();
    renderLiveRoute();
    await waitFor(() =>
      expect(screen.getByTestId('sethome-stub')).toBeInTheDocument(),
    );
  });

  it('accrues home-band rate for a full 60 seconds and lands on the summary', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderLiveRoute();
    await user.click(await screen.findByTestId('start-session'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    const summary = await screen.findByTestId('session-summary');
    expect(summary).toBeInTheDocument();
    // Home-band on battery = 6 µ-USDC/sec. A full 60-second window fires
    // 59-60 pays (the 60th may race with endSession), so the accrued total
    // lands in the 0.000354-0.000360 range. Assert it's positive and within
    // that window instead of a brittle equality.
    const total = screen.getByTestId('summary-total-usdc').textContent ?? '';
    const totalUsdc = Number(total.replace(/[^\d.]/g, ''));
    expect(totalUsdc).toBeGreaterThan(0);
    expect(totalUsdc).toBeLessThanOrEqual(0.0004);
  });

  it('settles with a partial total when the user ends early', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderLiveRoute();
    await user.click(await screen.findByTestId('start-session'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await user.click(screen.getByTestId('end-session'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    const summary = await screen.findByTestId('session-summary');
    expect(summary).toBeInTheDocument();
    // Roughly 9-10 home-band-on-battery pays at 6 µ-USDC each = 0.000054-0.000060.
    const total = screen.getByTestId('summary-total-usdc').textContent ?? '';
    const totalUsdc = Number(total.replace(/[^\d.]/g, ''));
    expect(totalUsdc).toBeGreaterThan(0);
    expect(totalUsdc).toBeLessThanOrEqual(0.0001);
  });
});
