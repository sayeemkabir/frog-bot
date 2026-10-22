import { useEffect, useState, type ReactNode } from 'react';
import type { Agent, AgentStatus } from '../../shared/types';

type IconProps = { size?: number };
const svg = (size: number, children: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const Icon = {
  Plus: ({ size = 18 }: IconProps) => svg(size, <path d="M12 5v14M5 12h14" />),
  Search: ({ size = 16 }: IconProps) => svg(size, <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  Send: ({ size = 18 }: IconProps) => svg(size, <path d="M5 12h14M13 6l6 6-6 6" />),
  Stop: ({ size = 14 }: IconProps) => svg(size, <rect x="6" y="6" width="12" height="12" rx="2" />),
  Close: ({ size = 18 }: IconProps) => svg(size, <path d="M6 6l12 12M18 6 6 18" />),
  Gear: ({ size = 18 }: IconProps) => svg(size, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  Chat: ({ size = 15 }: IconProps) => svg(size, <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />),
  Terminal: ({ size = 15 }: IconProps) => svg(size, <><path d="m5 8 4 4-4 4" /><path d="M12 16h7" /></>),
  Plug: ({ size = 18 }: IconProps) => svg(size, <><path d="M9 2v6M15 2v6" /><path d="M6 8h12v4a6 6 0 0 1-12 0z" /><path d="M12 18v4" /></>),
  Folder: ({ size = 16 }: IconProps) => svg(size, <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  File: ({ size = 16 }: IconProps) => svg(size, <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>),
  Back: ({ size = 16 }: IconProps) => svg(size, <path d="M15 18l-6-6 6-6" />),
  Users: ({ size = 16 }: IconProps) => svg(size, <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" /></>),
  Shield: ({ size = 16 }: IconProps) => svg(size, <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />),
  Trash: ({ size = 15 }: IconProps) => svg(size, <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>),
  Arrow: ({ size = 14 }: IconProps) => svg(size, <path d="M5 12h14M13 6l6 6-6 6" />),
  Monitor: ({ size = 30 }: IconProps) => svg(size, <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /><path d="M9.5 9.5l1.5 1.5 3.5-3.5" opacity={0.3} /></>),
  Moon: ({ size = 30 }: IconProps) => svg(size, <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />),
  Copy: ({ size = 14 }: IconProps) => svg(size, <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>),
  Pause: ({ size = 14 }: IconProps) => svg(size, <path d="M9 5v14M15 5v14" />),
  Down: ({ size = 14 }: IconProps) => svg(size, <path d="M12 5v14M6 13l6 6 6-6" />),
};

/** The Frog Bot mark: an original frog face. */
export function Logo({ className = 'brand-logo' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-label="Frog Bot">
      <defs>
        <linearGradient id="frog-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5ff0a0" />
          <stop offset="1" stopColor="#22b866" />
        </linearGradient>
      </defs>
      <circle cx="19" cy="20" r="11" fill="url(#frog-g)" />
      <circle cx="45" cy="20" r="11" fill="url(#frog-g)" />
      <ellipse cx="32" cy="38" rx="27" ry="21" fill="url(#frog-g)" />
      <circle cx="19" cy="19" r="6" fill="#fff" />
      <circle cx="45" cy="19" r="6" fill="#fff" />
      <circle cx="20" cy="20" r="3.2" fill="#0a0c0b" />
      <circle cx="46" cy="20" r="3.2" fill="#0a0c0b" />
      <path d="M20 41c6 6 18 6 24 0" stroke="#0a3a1f" strokeWidth="3.2" strokeLinecap="round" fill="none" />
      <circle cx="13" cy="37" r="3" fill="#ff8fa3" opacity="0.55" />
      <circle cx="51" cy="37" r="3" fill="#ff8fa3" opacity="0.55" />
    </svg>
  );
}

export function Avatar({ agent, size = 36, status }: { agent?: Pick<Agent, 'emoji' | 'color'>; size?: number; status?: AgentStatus }) {
  const color = agent?.color ?? '#3a4540';
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.5, background: `linear-gradient(145deg, ${color}40, ${color}18)`, border: `1px solid ${color}55` }}>
      <span>{agent?.emoji ?? '🤖'}</span>
      {status && <i className={`dot ${status}`} />}
    </div>
  );
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function GroupAvatar({ members, size = 36 }: { members: Agent[]; size?: number }) {
  if (members.length <= 1) {
    return (
      <div className="avatar group-avatar single" style={{ width: size, height: size, fontSize: size * 0.45 }}>
        <span>{members[0]?.emoji ?? '👥'}</span>
      </div>
    );
  }
  const shown = members.slice(0, 4);
  return (
    <div className="avatar group-avatar" style={{ width: size, height: size }}>
      {shown.map((m) => (
        <span key={m.id} style={{ background: `${m.color}33` }}>{m.emoji}</span>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, testId }: { on: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return <button type="button" data-testid={testId} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />;
}

/** A modal sheet that springs in and fades out (iOS-style). */
export function Sheet({ title, subtitle, onClose, children, footer, small, testId }: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  small?: boolean;
  testId?: string;
}) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    setClosing(true);
    setTimeout(onClose, 200);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className={`backdrop ${closing ? 'closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`sheet ${small ? 'small' : ''}`} data-testid={testId} role="dialog">
        <div className="sheet-head">
          <div style={{ flex: 1 }}>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" data-testid="sheet-close" onClick={close} aria-label="Close"><Icon.Close /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** A destructive button that needs a second tap within 4 seconds. */
export function ConfirmButton({ children, confirmText, onConfirm }: { children: ReactNode; confirmText: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button className={`btn danger ${armed ? 'armed' : ''}`} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? confirmText : children}
    </button>
  );
}

export function timeAgo(at: number) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(at).toLocaleDateString();
}

export function clock(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Inline markdown in ONE pass over escaped text, so generated HTML is never re-scanned. */
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)"<>]+)\)|(https?:\/\/[^\s<>"()]+)/g;

function link(href: string, label: string) {
  return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
}

function inline(text: string) {
  return text.replace(INLINE, (_m, code, bold, em, label, href, bare) => {
    if (code !== undefined) return `<code>${code}</code>`;
    if (bold !== undefined) return `<strong>${bold}</strong>`;
    if (em !== undefined) return `<em>${em}</em>`;
    if (label !== undefined) return link(href, label);
    return link(bare, bare);
  });
}

/** Small Markdown subset. Input is HTML-escaped first, so agent output can never inject markup. */
export function renderMarkdown(source: string) {
  const escaped = escapeHtml(source);
  const blocks = escaped.split(/```/);
  let html = '';
  blocks.forEach((block, i) => {
    if (i % 2 === 1) {
      html += `<pre><code>${block.replace(/^[a-z0-9]*\n/i, '')}</code></pre>`;
      return;
    }
    const lines = block.split('\n');
    let list: 'ul' | 'ol' | null = null;
    let para: string[] = [];
    const flushPara = () => {
      if (para.length) html += `<p>${inline(para.join('<br>'))}</p>`;
      para = [];
    };
    const closeList = () => {
      if (list) html += `</${list}>`;
      list = null;
    };
    for (const line of lines) {
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (bullet || numbered) {
        flushPara();
        const kind = bullet ? 'ul' : 'ol';
        if (list !== kind) {
          closeList();
          html += `<${kind}>`;
          list = kind;
        }
        html += `<li>${inline((bullet ?? numbered)![1])}</li>`;
      } else if (heading) {
        flushPara();
        closeList();
        html += `<h3>${inline(heading[2])}</h3>`;
      } else if (!line.trim()) {
        flushPara();
        closeList();
      } else {
        closeList();
        para.push(line);
      }
    }
    flushPara();
    closeList();
  });
  return html;
}
