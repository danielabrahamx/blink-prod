interface Props {
  charging: boolean | null;
  multiplier: number;
}

function labelFor(charging: boolean | null): string {
  if (charging === null) return 'AT DESK';
  return charging ? 'AT DESK' : 'ON THE MOVE';
}

function colorFor(charging: boolean | null): string {
  return charging === false ? '#e8a020' : '#34d399';
}

function captionFor(charging: boolean | null): string {
  if (charging === null) return 'Plug state pending — assuming at desk';
  return charging
    ? 'Plugged in · baseline rate'
    : 'On battery · rate doubles (proxy for being on the move)';
}

export function MultiplierDial({ charging, multiplier }: Props) {
  return (
    <div
      className="border border-[#1e1e1e] bg-[#0e0e0e] p-8 transition-colors"
      data-testid="multiplier-dial"
      data-charging={charging === null ? 'unknown' : charging ? 'plugged' : 'battery'}
    >
      <div className="text-xs uppercase tracking-widest text-[#666666] mb-3">
        Current state
      </div>
      <div
        className="font-bebas text-6xl leading-none tracking-widest"
        style={{ color: colorFor(charging) }}
      >
        {labelFor(charging)}
      </div>
      <div className="font-dm-mono text-4xl text-[#f0f0f0] mt-4">
        {multiplier.toFixed(2)}×
      </div>
      <p className="text-[#666666] text-sm mt-4 leading-relaxed">
        {captionFor(charging)}
      </p>
    </div>
  );
}
