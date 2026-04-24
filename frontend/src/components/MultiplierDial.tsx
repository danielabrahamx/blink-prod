import type { Band } from '@/lib/rulebookV2';

interface Props {
  band: Band;
  multiplier: number;
}

const BAND_LABEL: Record<Band, string> = {
  home: 'HOME',
  near: 'NEAR',
  away: 'AWAY',
};

const BAND_COLOR: Record<Band, string> = {
  home: '#34d399',
  near: '#e8a020',
  away: '#ef4444',
};

const BAND_CAPTION: Record<Band, string> = {
  home: 'Within 200 m of your home base',
  near: 'Up to 50 km from home',
  away: 'Far from home or international traffic',
};

export function MultiplierDial({ band, multiplier }: Props) {
  return (
    <div
      className="border border-[#1e1e1e] bg-[#0e0e0e] p-8 transition-colors"
      data-testid="multiplier-dial"
      data-band={band}
    >
      <div className="text-xs uppercase tracking-widest text-[#666666] mb-3">
        Current band
      </div>
      <div
        className="font-bebas text-6xl leading-none tracking-widest"
        style={{ color: BAND_COLOR[band] }}
      >
        {BAND_LABEL[band]}
      </div>
      <div className="font-dm-mono text-4xl text-[#f0f0f0] mt-4">
        {multiplier.toFixed(2)}×
      </div>
      <p className="text-[#666666] text-sm mt-4 leading-relaxed">
        {BAND_CAPTION[band]}
      </p>
    </div>
  );
}
