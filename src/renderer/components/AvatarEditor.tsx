import { useRef } from 'react';
import type { Agent } from '../../shared/types';
import { toast } from '../store';
import { Avatar, Icon } from './ui';

export const AVATAR_COLORS = ['#3f9d6e', '#5b7fc9', '#8a6fc4', '#c48a4f', '#c45f6f', '#4a9aa5', '#8f9a4a', '#6b7280'];
export const AVATAR_EMOJIS = ['🐸', '🦊', '🐙', '🦉', '🐝', '🐳', '🦁', '🐼', '🤖', '🧠', '📈', '🔎', '✍️', '🎧', '📚', '🛠️'];

export interface AvatarValue {
  avatarStyle: NonNullable<Agent['avatarStyle']>;
  emoji: string;
  color: string;
  avatarImage?: string;
}

/** Shrink a picked photo to a small square so it stays light to store and show. */
function toSquareDataUrl(file: File, size = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not an image'));
    };
    img.src = url;
  });
}

/** Pick how someone looks: initials (default), an emoji, or a photo, plus a colour. */
export function AvatarEditor({ name, value, onChange, allowLogo }: { name: string; value: AvatarValue; onChange: (v: AvatarValue) => void; allowLogo?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<AvatarValue>) => onChange({ ...value, ...patch });
  const pickPhoto = async (file?: File) => {
    if (!file) return;
    try {
      set({ avatarStyle: 'image', avatarImage: await toSquareDataUrl(file) });
    } catch (err) {
      toast('Could not use that picture', err instanceof Error ? err.message : String(err), 'error');
    }
  };
  const styles: { id: AvatarValue['avatarStyle']; label: string }[] = [
    { id: 'initials', label: 'Initials' },
    { id: 'emoji', label: 'Emoji' },
    { id: 'image', label: 'Photo' },
    ...(allowLogo ? [{ id: 'logo' as const, label: 'Frog mark' }] : []),
  ];
  return (
    <div className="field" data-testid="avatar-editor">
      <span>Picture</span>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <Avatar agent={{ name, ...value }} size={56} />
        <div style={{ display: 'grid', gap: 8, flex: 1 }}>
          <div className="avatar-picker">
            {styles.map((s) => (
              <button
                type="button"
                key={s.id}
                className={value.avatarStyle === s.id ? 'on' : ''}
                onClick={() => (s.id === 'image' && !value.avatarImage ? fileRef.current?.click() : set({ avatarStyle: s.id }))}
              >
                {s.label}
              </button>
            ))}
          </div>
          {value.avatarStyle === 'emoji' && (
            <div className="emoji-row">
              {AVATAR_EMOJIS.map((e) => <button type="button" key={e} className={e === value.emoji ? 'on' : ''} onClick={() => set({ emoji: e })}>{e}</button>)}
            </div>
          )}
          {value.avatarStyle === 'image' && (
            <button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={() => fileRef.current?.click()}>
              <span className="row" style={{ gap: 6 }}><Icon.Image /> {value.avatarImage ? 'Change photo' : 'Choose a photo'}</span>
            </button>
          )}
          {value.avatarStyle !== 'image' && value.avatarStyle !== 'logo' && (
            <div className="color-row">
              {AVATAR_COLORS.map((c) => <button type="button" key={c} className={c === value.color ? 'on' : ''} style={{ background: c }} onClick={() => set({ color: c })} aria-label={`Colour ${c}`} />)}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
        </div>
      </div>
    </div>
  );
}
