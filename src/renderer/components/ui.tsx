import { useEffect, useId, useState, type ReactNode } from 'react';
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
  Bolt: ({ size = 14 }: IconProps) => svg(size, <path d="M13 3 5 14h6l-1 7 8-11h-6z" />),
  Hand: ({ size = 14 }: IconProps) => svg(size, <path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3 15.5a1.6 1.6 0 0 1 2.4-2.1L8 16" />),
  Plan: ({ size = 14 }: IconProps) => svg(size, <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" /></>),
  Check: ({ size = 14 }: IconProps) => svg(size, <path d="m5 12.5 4.5 4.5L19 7" />),
  Alert: ({ size = 15 }: IconProps) => svg(size, <><path d="M12 4 2.8 19.5a1 1 0 0 0 .9 1.5h16.6a1 1 0 0 0 .9-1.5z" /><path d="M12 10v4M12 17.5v.01" /></>),
  Tool: ({ size = 13 }: IconProps) => svg(size, <path d="M14.5 6.5a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.1-5.1a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.6-.7-.7-2.6z" />),
  Dot: ({ size = 13 }: IconProps) => svg(size, <circle cx="12" cy="12" r="2.5" fill="currentColor" />),
  Globe: ({ size = 16 }: IconProps) => svg(size, <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>),
  LogOut: ({ size = 15 }: IconProps) => svg(size, <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 16l-4-4 4-4M6 12h10" /></>),
  Image: ({ size = 15 }: IconProps) => svg(size, <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>),
  ArrowRight: ({ size = 12 }: IconProps) => svg(size, <path d="M5 12h14M13 6l6 6-6 6" />),
};

const APP_MARKS: Record<string, { label: string; color: string }> = {
  slack: { label: 'S', color: '#611f69' },
  notion: { label: 'N', color: '#2f3033' },
  github: { label: 'GH', color: '#24292f' },
  linear: { label: 'L', color: '#5e6ad2' },
};

/** A connected app's icon: a line icon for the browser and custom apps, a lettered mark for known services. */
export function AppIcon({ integration, size = 34 }: { integration: { id: string; name: string; transport?: string }; size?: number }) {
  const key = Object.keys(APP_MARKS).find((k) => integration.id.startsWith(k) || integration.name.toLowerCase().startsWith(k));
  const mark = key ? APP_MARKS[key] : undefined;
  const glyph = integration.transport === 'builtin-browser' || integration.id === 'browser'
    ? <Icon.Globe size={size * 0.5} />
    : mark ? mark.label : <Icon.Plug size={size * 0.5} />;
  return (
    <span className="int-icon" style={{ width: size, height: size, fontSize: size * 0.4, ...(mark ? { background: mark.color, borderColor: 'transparent' } : {}) }}>
      {glyph}
    </span>
  );
}

/** Up to two initials from a name: "Docs Guy" → "DG", "frog" → "F". */
export function initials(name: string) {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 1) : words[0][0] + words[1][0]).toUpperCase();
}

/** A calm, darkened version of an agent's colour, so white initials stay readable. */
export function avatarFill(color?: string) {
  return `color-mix(in srgb, ${color || '#5b6470'} 72%, #101114)`;
}

/** The Frog Bot mark: a flat frog silhouette with the eyes cut out (same shape as the app icon, scripts/make-icons.mjs). */
export function Logo({ className = 'brand-logo' }: { className?: string }) {
  const id = useId();
  return (
    <svg className={className} viewBox="6 12 52 42" aria-label="Frog Bot">
      <mask id={id}>
        <rect x="0" y="0" width="64" height="64" fill="#fff" />
        <circle cx="20" cy="22" r="4" fill="#000" />
        <circle cx="44" cy="22" r="4" fill="#000" />
      </mask>
      <g fill="currentColor" mask={`url(#${id})`}>
        <circle cx="20" cy="22" r="10" />
        <circle cx="44" cy="22" r="10" />
        <rect x="6" y="24" width="52" height="30" rx="15" />
      </g>
    </svg>
  );
}

/**
 * The frame for the sign-in and first-run screens: what Frog Bot is on the left,
 * the form on the right. Narrow windows show only the form.
 */
export function WelcomeLayout({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="welcome" data-testid={testId}>
      <aside className="welcome-brand">
        <div className="welcome-mark"><Logo className="welcome-logo" /> Frog Bot</div>
        <div className="welcome-pitch">
          <h2>Your AI team, on your computer.</h2>
          <p>Agents that live on this computer, work together in front of you, and ask before they act for you.</p>
          <ul>
            <li><Icon.Users /><div><b>A team, not a chatbot</b><span>Give each agent a job. They hand work to each other.</span></div></li>
            <li><Icon.Shield /><div><b>You stay in control</b><span>Anything that sends, posts or deletes asks you first.</span></div></li>
            <li><Icon.Folder /><div><b>Local by design</b><span>Agents, chats, files and keys stay on this computer.</span></div></li>
          </ul>
        </div>
        <div className="welcome-foot">Open source · Windows · macOS · Linux</div>
      </aside>
      <main className="welcome-main">{children}</main>
    </div>
  );
}

type AvatarAgent = Partial<Pick<Agent, 'name' | 'emoji' | 'color' | 'avatarStyle' | 'avatarImage'>>;

/** An agent's (or person's) picture: initials on its colour by default, or the emoji, image or Frog Bot mark they chose. */
export function Avatar({ agent, size = 36, status }: { agent?: AvatarAgent; size?: number; status?: AgentStatus }) {
  const style = agent?.avatarStyle ?? 'initials';
  let content: ReactNode;
  let background = avatarFill(agent?.color);
  if (style === 'image' && agent?.avatarImage) {
    content = <img src={agent.avatarImage} alt="" />;
  } else if (style === 'logo') {
    content = <Logo className="logo-mark" />;
    background = 'color-mix(in srgb, var(--accent) 14%, var(--surface-2))';
  } else if (style === 'emoji' && agent?.emoji) {
    content = <span style={{ fontSize: size * 0.52 }}>{agent.emoji}</span>;
    background = `color-mix(in srgb, ${agent.color || '#5b6470'} 22%, #16181b)`;
  } else {
    content = <span style={{ fontSize: Math.max(10, size * 0.38) }}>{initials(agent?.name ?? '?')}</span>;
  }
  return (
    <div className="avatar" style={{ width: size, height: size, background }}>
      {content}
      {status && <i className={`dot ${status}`} />}
    </div>
  );
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** A group's picture: a small grid of its members' initials. */
export function GroupAvatar({ members, size = 36 }: { members: Agent[]; size?: number }) {
  if (members.length <= 1) {
    return (
      <div className="avatar group-avatar single" style={{ width: size, height: size, background: avatarFill(members[0]?.color) }}>
        <span style={{ fontSize: size * 0.36 }}>{members[0] ? initials(members[0].name) : <Icon.Users size={size * 0.5} />}</span>
      </div>
    );
  }
  // Two members' pictures overlapping, like a team chat's group icon.
  const inner = Math.round(size * 0.68);
  return (
    <div className="group-stack" style={{ width: size, height: size }}>
      <span style={{ left: 0, top: 0 }}><Avatar agent={members[0]} size={inner} /></span>
      <span style={{ right: 0, bottom: 0 }}><Avatar agent={members[1]} size={inner} /></span>
      {members.length > 2 && <i className="group-count">+{members.length - 2}</i>}
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
