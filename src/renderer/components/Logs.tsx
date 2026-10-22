import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry, LogLevel } from '../../shared/types';
import { api } from '../api';
import { attempt, setState, toast, useStore } from '../store';
import { Icon } from './ui';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
function stamp(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
function lineText(e: LogEntry) {
  return `${stamp(e.at)}  ${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.message}${e.data ? `  ${e.data}` : ''}`;
}

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const RENDER_LIMIT = 1500;

/** Everything that happens in Frog Bot, live, like a developer console. */
export function LogsView() {
  const logs = useStore((s) => s.logs);
  const [filter, setFilter] = useState('');
  const [level, setLevel] = useState<LogLevel>('debug');
  const [follow, setFollow] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return logs.filter((e) => LEVELS[e.level] >= LEVELS[level] && (!q || lineText(e).toLowerCase().includes(q)));
  }, [logs, filter, level]);
  const shown = filtered.slice(-RENDER_LIMIT);

  useLayoutEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [shown.length, follow, shown[shown.length - 1]?.seq]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(filtered.map(lineText).join('\n'));
    toast('Copied', `${filtered.length} log lines copied to the clipboard.`, 'success');
  };

  const download = () => {
    const blob = new Blob([filtered.map(lineText).join('\n') + '\n'], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `frogbot-${stamp(Date.now()).replace(/[: ]/g, '-').slice(0, 19)}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const counts = useMemo(() => {
    const c = { warn: 0, error: 0 };
    for (const e of logs) if (e.level === 'warn' || e.level === 'error') c[e.level]++;
    return c;
  }, [logs]);

  return (
    <section className="logs" data-testid="logs-view">
      <div className="logs-head">
        <span className="title"><Icon.Terminal /> frogbot ~ logs</span>
        <div className="grow" />
        <input className="term-input" placeholder="filter: agent:Frog, Tool, error…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className="term-select" value={level} onChange={(e) => setLevel(e.target.value as LogLevel)}>
          <option value="debug">all</option>
          <option value="info">info+</option>
          <option value="warn">warnings+</option>
          <option value="error">errors</option>
        </select>
        <button className={`term-btn ${follow ? 'on' : ''}`} onClick={() => setFollow((f) => !f)} title="Follow new lines">{follow ? '● live' : '❚❚ paused'}</button>
        <button className="term-btn" onClick={copy} title="Copy"><Icon.Copy /></button>
        <button className="term-btn" onClick={download} title="Save as file"><Icon.Down /></button>
        <button className="term-btn" onClick={() => attempt(() => api.openLogsFolder())} title="Open log folder"><Icon.Folder size={14} /></button>
        <button className="term-btn" onClick={() => attempt(async () => { await api.clearLogs(); setState({ logs: [] }); })}>clear</button>
      </div>
      <div className="terminal" ref={ref} onScroll={onScroll}>
        {filtered.length > shown.length && <div className="log-line"><span className="ts">…</span><span /><span /><span className="data">{filtered.length - shown.length} older lines hidden (use the filter or save as file)</span></div>}
        {shown.map((e) => (
          <div key={e.seq} className={`log-line ${e.level}`} data-testid="log-line">
            <span className="ts">{stamp(e.at)}</span>
            <span className={`lvl ${e.level}`}>{e.level.toUpperCase()}</span>
            <span className="src">[{e.source}]</span>
            <span><span className="msg">{e.message}</span>{e.data && <span className="data">  {e.data}</span>}</span>
          </div>
        ))}
        <div className="term-cursor">$ <span /></div>
      </div>
      <div className="logs-foot">
        <span>{logs.length} lines</span>
        <span style={{ color: counts.warn ? 'var(--warn)' : undefined }}>{counts.warn} warnings</span>
        <span style={{ color: counts.error ? 'var(--danger)' : undefined }}>{counts.error} errors</span>
        <span style={{ marginLeft: 'auto' }}>saved daily to FrogsWorld/logs</span>
      </div>
    </section>
  );
}
