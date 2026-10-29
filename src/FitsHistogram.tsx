import { useState } from 'react';
import type { FitsAnalysis } from './clients/storageClient';

export const analysisNumber = (value: number | null | undefined) => value == null ? 'Unavailable' : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
export const analysisPercent = (value: number | null | undefined) => value == null ? 'Unknown' : `${value > 0 && value < 0.001 ? '<0.001' : value.toFixed(3)}%`;

export function FitsHistogram({ analysis, black, white }: { analysis: FitsAnalysis; black: number; white: number }) {
  const [logarithmic, setLogarithmic] = useState(true);
  const scale = (count: number) => logarithmic ? Math.log1p(count) : count;
  const peak = Math.max(1, ...analysis.histogram.map(scale));
  const position = (value: number) => analysis.min != null && analysis.max != null && analysis.max > analysis.min
    ? Math.max(0, Math.min(512, (value - analysis.min) / (analysis.max - analysis.min) * 512)) : 0;
  return <figure className="fits-histogram" aria-label="Loaded FITS histogram">
    <figcaption>
      <strong>Unstretched FITS samples</strong>
      <label><input type="checkbox" checked={logarithmic} onChange={(event) => setLogarithmic(event.target.checked)} />Log counts</label>
      <span title="Finite full-resolution samples, before debayering. BSCALE and BZERO applied.">{analysis.valid_samples.toLocaleString()} samples</span>
    </figcaption>
    <svg viewBox="0 0 512 80" preserveAspectRatio="none" role="img" aria-label="Histogram of full-resolution FITS values">
      {analysis.histogram.map((count, index) => <rect key={index} x={index * 2} width="2" y={80 - scale(count) / peak * 76} height={scale(count) / peak * 76}><title>{count.toLocaleString()} samples</title></rect>)}
      {analysis.valid_samples > 0 ? <>
        <line className="histogram-black" x1={position(black)} x2={position(black)} y1="0" y2="80"><title>Display black: {black}</title></line>
        <line className="histogram-white" x1={position(white)} x2={position(white)} y1="0" y2="80"><title>Display white: {white}</title></line>
      </> : null}
    </svg>
    <div className="histogram-axis"><span>{analysisNumber(analysis.min)}</span><span>FITS values</span><span>{analysisNumber(analysis.max)}</span></div>
    <div className="histogram-summary">
      <span title="Raw scaled samples at or below zero; independent of display stretch. Not a camera black-level estimate.">At/below zero: <strong>{analysisPercent(analysis.nonpositive_percent)}</strong></span>
      <span title={analysis.saturation_source === 'SATURATE' ? `Header SATURATE threshold: ${analysis.saturation_limit}` : 'At the scaled integer file ceiling; actual sensor saturation may be lower. Floating-point data needs a SATURATE header.'}>
        {analysis.saturation_source === 'file ceiling' ? 'At file ceiling' : 'Saturation (header)'}: <strong>{analysisPercent(analysis.saturation_percent)}</strong>
      </span>
      {analysis.excluded_samples > 0 ? <span>Excluded: {analysis.excluded_samples.toLocaleString()}</span> : null}
    </div>
  </figure>;
}
