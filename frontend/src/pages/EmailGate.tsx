import WaitlistForm from "@/components/WaitlistForm";
import { markSkippedThisSession } from "@/lib/emailGate";

interface EmailGateProps {
  onPass: () => void;
}

const EmailGate = ({ onPass }: EmailGateProps) => {
  const handleSkip = () => {
    markSkippedThisSession();
    onPass();
  };

  return (
    <div className="min-h-screen bg-[#080808] text-[#f0f0f0] flex flex-col">
      {/* Nav */}
      <nav className="border-b border-[#1a1a1a] px-8 py-4 flex items-center justify-between">
        <span className="font-bebas text-2xl text-[#f0f0f0] tracking-widest">BLINK</span>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#e8a020] blink-pulse" />
          <span className="text-xs text-[#666666] uppercase tracking-widest ml-1">Arc Testnet</span>
        </div>
      </nav>

      {/* Hero */}
      <div className="flex-1 max-w-3xl w-full mx-auto px-8 pt-20 pb-16">
        <div className="mb-4">
          <span className="text-xs uppercase tracking-widest text-[#e8a020] font-dm-mono border border-[#e8a020]/30 px-3 py-1">
            x402 · Gasless · Per-Second
          </span>
        </div>

        <h1 className="font-bebas text-[clamp(56px,10vw,104px)] leading-[0.95] text-[#f0f0f0] mb-6 tracking-wide">
          INSURANCE<br />
          <span className="text-[#e8a020]">BY THE SECOND.</span>
        </h1>

        <p className="text-[#888888] text-lg max-w-xl mb-2 leading-relaxed">
          Laptop insurance priced for your exact amount of risk. Stop overpaying a flat premium that charges the same for a safe morning at your desk and a risky evening in a bar abroad.
        </p>
        <p className="text-[#555555] text-base mb-10">
          Join the waitlist for priority access at mainnet.
        </p>

        <WaitlistForm variant="gate" onSuccess={onPass} />

        <div className="mt-10 pt-6 border-t border-[#1a1a1a]">
          <button
            type="button"
            onClick={handleSkip}
            className="group inline-flex items-center gap-2 text-[#666666] hover:text-[#e8a020] text-xs uppercase tracking-widest font-dm-mono transition-colors"
          >
            Skip to demo
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#1a1a1a] px-8 py-6 flex items-center justify-between">
        <span className="font-bebas text-lg text-[#333333] tracking-widest">BLINK</span>
        <p className="hidden md:block text-xs text-[#333333] font-dm-mono">
          © 2026 Blink. Per-second laptop micro-insurance.
        </p>
        <div className="text-xs text-[#333333] font-dm-mono uppercase tracking-widest">
          Arc Testnet
        </div>
      </footer>
    </div>
  );
};

export default EmailGate;
