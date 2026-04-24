import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MapPin, Loader2 } from 'lucide-react';
import { useGeolocation } from '@/lib/geolocation';
import { readHomeSpawn, writeHomeSpawn } from '@/lib/homeSpawn';
import { fetchIpCountry } from '@/lib/ipCountry';
import { hasPassedGate } from '@/lib/emailGate';

/**
 * Onboarding step before the /live session. Requests geolocation,
 * pairs it with a best-effort IP-country lookup (for the international
 * override), and persists the result to localStorage.
 */
export default function SetHome() {
  const navigate = useNavigate();
  const geo = useGeolocation();
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const existing = readHomeSpawn();

  useEffect(() => {
    if (!hasPassedGate()) navigate('/', { replace: true });
  }, [navigate]);

  const handleContinue = async (): Promise<void> => {
    if (!geo.position) return;
    setSaving(true);
    const country = await fetchIpCountry();
    writeHomeSpawn({
      lat: geo.position.coords.latitude,
      lng: geo.position.coords.longitude,
      country: country ?? undefined,
    });
    navigate('/live');
  };

  const statusLine = (() => {
    if (geo.status === 'unsupported') {
      return 'Your browser does not expose the Geolocation API. Try Chrome or Edge.';
    }
    if (geo.status === 'denied') {
      return 'Geolocation permission denied. Allow it in your browser settings and reload.';
    }
    if (geo.status === 'error') {
      return 'Could not read your location. Check that you have a GPS/network fix and try again.';
    }
    if (geo.status === 'pending') {
      return 'Waiting for your browser to share a location fix…';
    }
    return `Got it · ${geo.position?.coords.latitude.toFixed(4)}, ${geo.position?.coords.longitude.toFixed(4)} (±${Math.round(geo.position?.coords.accuracy ?? 0)} m)`;
  })();

  return (
    <div className="min-h-screen bg-[#080808] text-[#f0f0f0]">
      <nav className="border-b border-[#1a1a1a] px-8 py-4 flex items-center justify-between">
        <span className="font-bebas text-2xl tracking-widest">BLINK</span>
        <span className="text-xs uppercase tracking-widest text-[#666666]">
          Set home · 1 / 2
        </span>
      </nav>

      <main className="max-w-xl mx-auto px-8 pt-16 pb-12">
        <h1 className="font-bebas text-5xl tracking-wide mb-4">PICK YOUR HOME BASE</h1>
        <p className="text-[#888888] leading-relaxed mb-10">
          Your multiplier is <span className="text-[#34d399]">1.0×</span> inside
          a 200 m radius of home. It steps to 1.33× within 50 km and to 2.0× if
          you travel further or your IP country changes.
        </p>

        <div className="border border-[#1e1e1e] bg-[#0e0e0e] p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-[#141414] border border-[#1e1e1e]">
              <MapPin className="h-5 w-5 text-[#e8a020]" />
            </div>
            <div className="flex-1">
              <div className="text-xs uppercase tracking-widest text-[#666666] mb-1">
                Geolocation
              </div>
              <p className="text-sm text-[#f0f0f0]">{statusLine}</p>
            </div>
          </div>
        </div>

        {existing && !resetting && (
          <div className="border border-[#1e1e1e] bg-[#0e0e0e] p-6 mb-6">
            <div className="text-xs uppercase tracking-widest text-[#666666] mb-2">
              Home already saved
            </div>
            <p className="text-sm text-[#888888]">
              {existing.lat.toFixed(4)}, {existing.lng.toFixed(4)}
              {existing.country ? ` · ${existing.country}` : ''}
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => navigate('/live')}
                className="flex-1 bg-[#e8a020] text-[#080808] font-dm-mono uppercase text-sm tracking-widest py-3 hover:bg-[#f5b530] transition-colors"
              >
                Continue to live
                <ArrowRight className="h-4 w-4 inline ml-2" />
              </button>
              <button
                type="button"
                onClick={() => setResetting(true)}
                className="flex-1 border border-[#1e1e1e] text-[#888888] font-dm-mono uppercase text-sm tracking-widest py-3 hover:border-[#666666] hover:text-[#f0f0f0] transition-colors"
              >
                Re-set home
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={geo.status !== 'granted' || saving}
          className="w-full bg-[#e8a020] text-[#080808] font-dm-mono uppercase text-sm tracking-widest py-4 hover:bg-[#f5b530] transition-colors disabled:bg-[#1a1a1a] disabled:text-[#444444] disabled:cursor-not-allowed flex items-center justify-center gap-2"
          data-testid="set-home-continue"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              Use my current location
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        <p className="text-xs text-[#444444] font-dm-mono mt-6 leading-relaxed">
          Blink stores home as a lat/lng + country in your browser only. Nothing
          is sent to a server until you start a session.
        </p>
      </main>
    </div>
  );
}
