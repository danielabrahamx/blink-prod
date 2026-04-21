import { useEffect } from "react";
import { useForm, ValidationError } from "@formspree/react";
import { ArrowRight, Check } from "lucide-react";
import { markSignedUp } from "@/lib/emailGate";

type Variant = "gate" | "dialog";

interface WaitlistFormProps {
  variant?: Variant;
  onSuccess?: () => void;
}

const FORMSPREE_ID = "mrerapkk";

const WaitlistForm = ({ variant = "gate", onSuccess }: WaitlistFormProps) => {
  const [state, handleSubmit] = useForm(FORMSPREE_ID);

  useEffect(() => {
    if (!state.succeeded) return;
    markSignedUp();
    const t = window.setTimeout(() => onSuccess?.(), 1200);
    return () => window.clearTimeout(t);
  }, [state.succeeded, onSuccess]);

  if (state.succeeded) {
    return (
      <div className="flex items-center gap-3 border border-[#e8a020] bg-[#0e0e0e] px-5 py-4">
        <span className="p-1 bg-[#e8a020]">
          <Check className="h-4 w-4 text-[#080808]" strokeWidth={3} />
        </span>
        <div>
          <p className="font-bebas text-2xl tracking-widest text-[#f0f0f0]">YOU'RE IN</p>
          <p className="font-dm-mono text-xs text-[#888888] mt-1">
            {variant === "gate" ? "Loading demo…" : "Thanks — we'll be in touch."}
          </p>
        </div>
      </div>
    );
  }

  const fieldErrorCount = state.errors?.getFieldErrors?.("email")?.length ?? 0;
  const formErrorCount = state.errors?.getFormErrors?.()?.length ?? 0;
  const hasOpaqueError =
    !state.submitting && state.errors !== null && fieldErrorCount === 0 && formErrorCount === 0;

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full">
      <div className="flex flex-col md:flex-row gap-3 w-full">
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@builder.xyz"
          disabled={state.submitting}
          aria-label="Email address"
          className="flex-1 bg-[#0e0e0e] border border-[#1a1a1a] focus:border-[#e8a020] focus:outline-none rounded-none px-4 py-3 font-dm-mono text-sm text-[#f0f0f0] placeholder:text-[#444444] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={state.submitting}
          className="group inline-flex items-center justify-center gap-2 bg-[#e8a020] text-[#080808] hover:bg-[#f0b030] px-6 py-3 font-bebas text-lg tracking-widest rounded-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {state.submitting ? "SENDING…" : "REQUEST ACCESS"}
          {!state.submitting && (
            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
          )}
        </button>
      </div>
      <ValidationError
        field="email"
        prefix="Email"
        errors={state.errors}
        className="block mt-2 text-xs text-[#d32f2f] font-dm-mono"
      />
      <ValidationError
        errors={state.errors}
        className="block mt-2 text-xs text-[#d32f2f] font-dm-mono"
      />
      {hasOpaqueError && (
        <p className="mt-2 text-xs text-[#d32f2f] font-dm-mono">
          Couldn't reach the server. Check your connection or disable any ad blocker for this page, then try again.
        </p>
      )}
      <p className="mt-3 text-xs text-[#555555] font-dm-mono">
        No spam. Priority access when Blink opens to mainnet.
      </p>
    </form>
  );
};

export default WaitlistForm;
