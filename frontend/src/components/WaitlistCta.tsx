import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import WaitlistForm from "@/components/WaitlistForm";

interface WaitlistCtaProps {
  onSignedUp: () => void;
}

const WaitlistCta = ({ onSignedUp }: WaitlistCtaProps) => {
  const [open, setOpen] = useState(false);

  const handleSuccess = () => {
    setOpen(false);
    onSignedUp();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group fixed z-40 bottom-0 left-0 right-0 md:left-auto md:bottom-6 md:right-6 inline-flex items-center justify-center gap-2 bg-[#e8a020] text-[#080808] hover:bg-[#f0b030] px-5 py-3 font-bebas text-base tracking-widest shadow-lg transition-colors animate-in fade-in slide-in-from-bottom-4 duration-300"
          aria-label="Join the waitlist"
        >
          <span className="w-2 h-2 rounded-full bg-[#080808] blink-pulse" />
          Join the waitlist
          <span className="transition-transform group-hover:translate-x-1">→</span>
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[#080808] border border-[#1a1a1a] rounded-none max-w-lg p-0">
        <div className="p-8">
          <div className="mb-3">
            <span className="text-xs uppercase tracking-widest text-[#e8a020] font-dm-mono border border-[#e8a020]/30 px-3 py-1">
              x402 · Gasless · Per-Second
            </span>
          </div>
          <h2 className="font-bebas text-4xl tracking-widest text-[#f0f0f0] mb-3 leading-none">
            Join the waitlist
          </h2>
          <p className="text-[#888888] text-sm mb-6 leading-relaxed">
            A premium that rises and falls with your real-time risk. Get priority access at mainnet.
          </p>
          <WaitlistForm variant="dialog" onSuccess={handleSuccess} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WaitlistCta;
