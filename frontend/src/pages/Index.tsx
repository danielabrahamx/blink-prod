import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Shield, TrendingUp, ArrowRight, Laptop, Building2 } from "lucide-react";
import InsuracleDashboardAdmin from '@/InsuracleDashboardAdmin';
import EmailGate from '@/pages/EmailGate';
import WaitlistCta from '@/components/WaitlistCta';
import { hasPassedGate, hasSignedUp } from '@/lib/emailGate';

const Index = () => {
  const navigate = useNavigate();
  const [userType, setUserType] = useState<"company" | null>(null);
  const [gatePassed, setGatePassed] = useState<boolean>(() => hasPassedGate());
  const [signedUp, setSignedUp] = useState<boolean>(() => hasSignedUp());

  if (!gatePassed) {
    return (
      <EmailGate
        onPass={() => {
          setGatePassed(true);
          setSignedUp(hasSignedUp());
        }}
      />
    );
  }

  const waitlistCta = !signedUp ? (
    <WaitlistCta onSignedUp={() => setSignedUp(true)} />
  ) : null;

  if (userType === "company") {
    return (
      <>
        <InsuracleDashboardAdmin setUserType={setUserType as unknown as (userType: string) => void} />
        {waitlistCta}
      </>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-[#080808] text-[#f0f0f0]">

      {/* Nav */}
      <nav className="border-b border-[#1a1a1a] px-8 py-4 flex items-center justify-between">
        <span className="font-bebas text-2xl text-[#f0f0f0] tracking-widest">BLINK</span>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#e8a020] blink-pulse" />
          <span className="text-xs text-[#666666] uppercase tracking-widest ml-1">Arc Testnet</span>
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-4xl mx-auto px-8 pt-20 pb-16">
        <div className="mb-3">
          <span className="text-xs uppercase tracking-widest text-[#e8a020] font-dm-mono border border-[#e8a020]/30 px-3 py-1">
            x402 · Gasless · Per-Second
          </span>
        </div>

        <h1 className="font-bebas text-[clamp(80px,16vw,160px)] leading-none text-[#f0f0f0] mb-6 tracking-wide">
          BLINK
        </h1>

        <p className="text-[#888888] text-xl max-w-xl mb-2 leading-relaxed">
          Laptop insurance priced for your exact amount of risk.
        </p>
        <p className="text-[#555555] text-base mb-12">
          Stop overpaying a flat premium. Your rate rises and falls every second with your real-time risk.
        </p>

        {/* Access cards */}
        <div className="grid md:grid-cols-2 gap-4 mb-20">

          {/* Live demo card */}
          <button
            onClick={() => navigate('/live')}
            className="group text-left bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#e8a020] p-8 transition-all duration-200"
            data-testid="cta-live-demo"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="p-2 bg-[#141414] border border-[#1e1e1e] group-hover:border-[#e8a020]/30 transition-colors">
                <Laptop className="h-5 w-5 text-[#e8a020]" />
              </div>
              <ArrowRight className="h-4 w-4 text-[#444444] group-hover:text-[#e8a020] group-hover:translate-x-1 transition-all duration-200" />
            </div>
            <h2 className="font-bebas text-3xl tracking-widest mb-2 text-[#f0f0f0]">TRY THE LIVE DEMO</h2>
            <p className="text-[#666666] text-sm leading-relaxed">
              Run a 60-second session where your premium reacts to whether
              your laptop is at your desk (plugged in) or on the move (on
              battery). Unplug mid-session to see the rate double.
            </p>
            <div className="mt-6 pt-4 border-t border-[#1a1a1a]">
              <span className="font-dm-mono text-xs text-[#444444]">At Desk baseline · 2× On The Move</span>
            </div>
          </button>

          {/* Admin card */}
          <button
            onClick={() => setUserType("company")}
            className="group text-left bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#888888] p-8 transition-all duration-200"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="p-2 bg-[#141414] border border-[#1e1e1e] group-hover:border-[#666666]/30 transition-colors">
                <Building2 className="h-5 w-5 text-[#888888]" />
              </div>
              <ArrowRight className="h-4 w-4 text-[#444444] group-hover:text-[#888888] group-hover:translate-x-1 transition-all duration-200" />
            </div>
            <h2 className="font-bebas text-3xl tracking-widest mb-2 text-[#f0f0f0]">
              ADMIN PORTAL
              <span className="ml-3 text-sm font-dm-sans border border-[#444444] text-[#888888] px-2 py-0.5 align-middle">
                INSURER
              </span>
            </h2>
            <p className="text-[#666666] text-sm leading-relaxed">
              Manage reserves, deposit USYC collateral, and trigger claim payouts from the insurance pool.
            </p>
            <div className="mt-6 pt-4 border-t border-[#1a1a1a]">
              <span className="font-dm-mono text-xs text-[#444444]">Circle Dev Wallet · USYC Reserve</span>
            </div>
          </button>

        </div>

        {/* Features row */}
        <div className="border-t border-[#1a1a1a] pt-12">
          <div className="grid md:grid-cols-3 gap-8">

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Zap className="h-4 w-4 text-[#e8a020]" />
                <span className="text-xs uppercase tracking-widest text-[#888888]">Pay Per Second</span>
              </div>
              <p className="text-[#555555] text-sm leading-relaxed">
                Pay by the second for the exact coverage you're using. No flat annual premium, no wasted months.
              </p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-4 w-4 text-[#e8a020]" />
                <span className="text-xs uppercase tracking-widest text-[#888888]">Two Risk Modes</span>
              </div>
              <p className="text-[#555555] text-sm leading-relaxed">
                At Desk or On The Move. Different rates that match your laptop's real-time risk.
              </p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="h-4 w-4 text-[#e8a020]" />
                <span className="text-xs uppercase tracking-widest text-[#888888]">Instant Activation</span>
              </div>
              <p className="text-[#555555] text-sm leading-relaxed">
                No setup fees, no claim paperwork. Coverage turns on the second you connect.
              </p>
            </div>

          </div>
        </div>

      </div>

      {/* Footer */}
      <footer className="border-t border-[#1a1a1a] px-8 py-6 flex items-center justify-between">
        <span className="font-bebas text-lg text-[#333333] tracking-widest">BLINK</span>
        <p className="text-xs text-[#333333] font-dm-mono">© 2026 Blink. Per-second laptop micro-insurance.</p>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/admin/gateway')}
            className="text-xs text-[#333333] hover:text-[#888888] font-dm-mono uppercase tracking-widest transition-colors"
          >
            Admin
          </button>
          <div className="text-xs text-[#333333] font-dm-mono uppercase tracking-widest">Arc Testnet</div>
        </div>
      </footer>

    </div>
    {waitlistCta}
    </>
  );
};

export default Index;
