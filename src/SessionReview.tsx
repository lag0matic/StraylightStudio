import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, FolderOpen, ImageOff, RefreshCw, X } from 'lucide-react';
import { reviewClient } from './clients/reviewClient';
import type { ReviewDecision, ReviewFolder, ReviewFrame } from './clients/reviewClient';
import type { FitsAnalysis, RenderFitsPreviewResult } from './clients/storageClient';
import { settingsClient } from './clients/settingsClient';
import { tauriClient } from './clients/tauriClient';
import { FitsHistogram, analysisNumber } from './FitsHistogram';

const pageSize = 10;
const folderKey = 'straylight-review-folder-v1';
const identity = (frame: ReviewFrame) => `${frame.relative_path}:${frame.fingerprint}`;
const exposure = (frame: ReviewFrame) => frame.metadata.EXPTIME ?? frame.metadata.EXPOSURE;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function SessionReview({ active }: { active: boolean }) {
  const [folder, setFolder] = useState<ReviewFolder | null>(null);
  const [recent, setRecent] = useState('');
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState<ReviewDecision | 'all'>('all');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [preview, setPreview] = useState<RenderFitsPreviewResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [measured, setMeasured] = useState<Record<string, FitsAnalysis>>({});
  const scanId = useRef(0);
  const desktop = tauriClient.isDesktopRuntime();

  useEffect(() => {
    let closed = false;
    void settingsClient.loadDesktopSettings<Record<string, unknown>>().then((saved) => {
      const value = saved?.[folderKey] as { root?: unknown } | undefined;
      if (!closed && typeof value?.root === 'string') setRecent(value.root);
    }).catch(() => {});
    return () => { closed = true; ++scanId.current; };
  }, []);

  const load = async (root: string) => {
    const id = ++scanId.current;
    setScanning(true); setError(''); setStatus('');
    try {
      const result = await reviewClient.scan(root);
      if (id !== scanId.current) return;
      setFolder(result); setSelected(''); setPage(0); setFilter('all'); setMeasured({});
      setRevision((current) => current + 1);
      setPreview(null); setPreviewError(''); setRecent(result.root);
      settingsClient.saveJson(folderKey, { root: result.root });
    } catch (caught) { if (id === scanId.current) setError(message(caught)); }
    finally { if (id === scanId.current) setScanning(false); }
  };
  const choose = async () => {
    setScanning(true);
    try { const root = await reviewClient.choose(); if (typeof root === 'string') await load(root); }
    catch (caught) { setError(message(caught)); }
    finally { setScanning(false); }
  };
  const frames = useMemo(() => (folder?.frames ?? []).filter((frame) => filter === 'all' || frame.decision === filter).sort((a, b) => {
    if (sort !== 'name') {
      const value = (frame: ReviewFrame) => sort === 'exposure' ? exposure(frame) : sort === 'temperature' ? frame.metadata['CCD-TEMP'] : frame.metadata.GAIN;
      const av = value(a) == null ? NaN : Number(value(a));
      const bv = value(b) == null ? NaN : Number(value(b));
      if (Number.isFinite(av) !== Number.isFinite(bv)) return Number.isFinite(av) ? -1 : 1;
      if (Number.isFinite(av) && av !== bv) return av - bv;
    }
    return a.relative_path.localeCompare(b.relative_path, undefined, { numeric: true });
  }), [folder, filter, sort]);
  const frame = frames.find((item) => item.relative_path === selected) ?? frames[0];
  const index = frame ? frames.indexOf(frame) : -1;
  const lastPage = Math.max(0, Math.ceil(frames.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = frames.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const visibleKey = visible.map(identity).join('|');

  useEffect(() => {
    let closed = false;
    setThumbnails({});
    if (!active || !folder) return;
    void (async () => {
      for (const item of visible) {
        if (closed) return;
        if (item.error) continue;
        try {
          const result = await reviewClient.preview(folder.root, item, true);
          if (!closed) setThumbnails((previous) => ({ ...previous, [identity(item)]: result.data_url }));
        } catch { /* A corrupt frame must not prevent the remaining thumbnails. */ }
      }
    })();
    return () => { closed = true; };
  }, [active, folder?.root, visibleKey, revision]);

  useEffect(() => {
    let closed = false;
    setPreview(null); setPreviewError(''); setRendering(false);
    if (!active || !folder || !frame) return;
    if (frame.error) { setPreviewError(frame.error); return; }
    setRendering(true);
    const timer = window.setTimeout(() => { void reviewClient.preview(folder.root, frame).then((result) => {
      if (closed) return;
      setPreview(result);
      if (result.analysis) setMeasured((previous) => ({ ...previous, [identity(frame)]: result.analysis! }));
    }).catch((caught) => { if (!closed) setPreviewError(message(caught)); })
      .finally(() => { if (!closed) setRendering(false); }); }, 150);
    return () => { closed = true; window.clearTimeout(timer); };
  }, [active, folder?.root, frame?.relative_path, frame?.fingerprint, revision]);

  const selectIndex = (next: number) => {
    const item = frames[next];
    if (item) { setSelected(item.relative_path); setPage(Math.floor(next / pageSize)); }
  };
  const decide = async (decision: ReviewDecision) => {
    if (!folder || !frame || saving) return;
    const root = folder.root;
    setSaving(true); setError(''); setStatus('');
    try {
      await reviewClient.decide(root, frame, decision);
      setFolder((current) => current?.root === root ? { ...current, frames: current.frames.map((item) => identity(item) === identity(frame) ? { ...item, decision } : item) } : current);
      setStatus(`Saved ${decision}: ${frame.relative_path}`);
    } catch (caught) { setError(`Decision not saved: ${message(caught)}`); }
    finally { setSaving(false); }
  };
  const counts = (decision: ReviewDecision) => folder?.frames.filter((item) => item.decision === decision).length ?? 0;
  const analysis = preview?.analysis;

  return <section className="session-review" aria-label="Session review" onKeyDown={(event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement).closest('input, select, textarea')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); selectIndex(index - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); selectIndex(index + 1); }
  }}>
    <div className="review-toolbar">
      <button onClick={() => void choose()} disabled={!desktop || scanning || saving}><FolderOpen size={16} />Open Folder</button>
      {!folder && recent ? <button onClick={() => void load(recent)} disabled={!desktop || scanning || saving} title={recent}><FolderOpen size={16} />Reopen Folder</button> : null}
      <button onClick={() => folder && void load(folder.root)} disabled={!folder || scanning || saving} title="Refresh folder" aria-label="Refresh review folder"><RefreshCw size={16} /></button>
      <span className="review-root" title={folder?.root}>{scanning ? 'Scanning folder...' : folder?.root || 'No session folder open'}</span>
      <span>{folder?.frames.length ?? 0} frames</span>
      <span>{counts('keep')} keep / {counts('reject')} reject / {counts('undecided')} undecided</span>
    </div>
    {!desktop ? <p className="review-message">Folder review is available in the desktop app.</p> : null}
    {error ? <p className="review-message" role="alert">{error}</p> : null}
    {folder?.decision_error ? <p className="review-message" role="alert">Decisions are read-only: {folder.decision_error}</p> : null}
    {folder?.warnings.length ? <details className="review-message"><summary>{folder.warnings.length} folder warnings</summary>{folder.warnings.map((warning, i) => <div key={i}>{warning}</div>)}</details> : null}
    {folder ? <div className="review-workspace">
      <div className="review-browser">
        <div className="review-toolbar">
          <label>Show<select aria-label="Review decision filter" value={filter} onChange={(event) => { setFilter(event.target.value as typeof filter); setPage(0); }}>
            <option value="all">All frames</option><option value="keep">Keep</option><option value="reject">Reject</option><option value="undecided">Undecided</option>
          </select></label>
          <label>Sort<select aria-label="Review sort order" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }}>
            <option value="name">Filename</option><option value="exposure">Exposure</option><option value="temperature">Temperature</option><option value="gain">Gain</option>
          </select></label>
        </div>
        <div className="review-frame-list" aria-label="Review frames">
          {visible.map((item) => <button key={identity(item)} className={`review-frame ${frame === item ? 'selected' : ''}`} aria-pressed={frame === item} onClick={() => setSelected(item.relative_path)} title={item.relative_path}>
            <span className="review-thumb">{thumbnails[identity(item)] ? <img src={thumbnails[identity(item)]} alt="" /> : <ImageOff size={20} />}</span>
            <span className="review-frame-info"><strong>{item.relative_path}</strong>
              <span>{item.metadata.IMAGETYP || '--'} | {exposure(item) ?? '--'} s | {item.metadata['CCD-TEMP'] ?? '--'} C | Gain {item.metadata.GAIN ?? '--'}</span>
              <span>Median {measured[identity(item)] ? analysisNumber(measured[identity(item)].median) : '--'} | Std dev {measured[identity(item)] ? analysisNumber(measured[identity(item)].std_dev) : '--'}</span>
              {item.error ? <span className="review-file-error">Header unreadable</span> : null}
            </span>
            <span className={`review-decision ${item.decision}`}>{item.decision === 'keep' ? <Check size={15} /> : item.decision === 'reject' ? <X size={15} /> : <CircleHelp size={15} />}<span>{item.decision}</span></span>
          </button>)}
          {!frames.length ? <p className="review-message">{folder.frames.length ? 'No frames match this filter.' : 'No FITS files found.'}</p> : null}
        </div>
        <div className="review-toolbar review-pagination">
          <button aria-label="Previous frame page" title="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ArrowLeft size={16} /></button>
          <span>{frames.length ? currentPage + 1 : 0} / {frames.length ? lastPage + 1 : 0}</span>
          <button aria-label="Next frame page" title="Next page" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}><ArrowRight size={16} /></button>
        </div>
      </div>
      <div className="review-inspector">
        <div className="review-toolbar">
          <button aria-label="Previous review frame" title="Previous frame" disabled={index <= 0} onClick={() => selectIndex(index - 1)}><ArrowLeft size={16} /></button>
          <span>{index < 0 ? 0 : index + 1} / {frames.length}</span>
          <button aria-label="Next review frame" title="Next frame" disabled={index < 0 || index >= frames.length - 1} onClick={() => selectIndex(index + 1)}><ArrowRight size={16} /></button>
          <strong className="review-file-title" title={frame?.relative_path}>{frame?.relative_path || 'No frame selected'}</strong>
        </div>
        <div className="review-image" aria-busy={rendering}>
          {preview ? <img src={preview.data_url} alt={frame?.relative_path} /> : <span>{rendering ? 'Rendering FITS...' : previewError || 'No preview'}</span>}
        </div>
        <div className="review-toolbar review-actions" aria-label="Frame decision">
          <button disabled={!frame || saving || scanning || !!folder.decision_error} aria-pressed={frame?.decision === 'keep'} onClick={() => void decide('keep')}><Check size={16} />Keep</button>
          <button disabled={!frame || saving || scanning || !!folder.decision_error} aria-pressed={frame?.decision === 'reject'} onClick={() => void decide('reject')}><X size={16} />Reject</button>
          <button disabled={!frame || saving || scanning || !!folder.decision_error} aria-pressed={frame?.decision === 'undecided'} onClick={() => void decide('undecided')}><CircleHelp size={16} />Undecided</button>
          <span role="status">{saving ? 'Saving decision...' : status}</span>
        </div>
        {frame ? <dl className="review-stats">
          {[
            ['Target', frame.metadata.OBJECT], ['Type', frame.metadata.IMAGETYP], ['Exposure (s)', exposure(frame)], ['Temperature (C)', frame.metadata['CCD-TEMP']],
            ['Gain', frame.metadata.GAIN], ['Filter', frame.metadata.FILTER], ['Captured', frame.metadata['DATE-OBS']],
            ['Mean', analysisNumber(analysis?.mean)], ['Median', analysisNumber(analysis?.median)], ['Std dev', analysisNumber(analysis?.std_dev)],
            ['Min / Max', `${analysisNumber(analysis?.min)} / ${analysisNumber(analysis?.max)}`]
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '--'}</dd></div>)}
        </dl> : null}
        {analysis && preview ? <FitsHistogram analysis={analysis} black={preview.black_point} white={preview.white_point} /> : null}
      </div>
    </div> : null}
  </section>;
}
