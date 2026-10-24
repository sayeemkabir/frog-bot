import { useState } from 'react';
import { authApi } from '../api';
import { attempt, setState, toast, useStore } from '../store';
import { AvatarEditor } from './AvatarEditor';
import { Icon, Sheet } from './ui';

/** Your name and picture, and sign out. */
export function ProfileSheet() {
  const auth = useStore((s) => s.auth);
  const user = auth?.user;
  const [name, setName] = useState(user?.profile.name ?? '');
  if (!user) return null;

  const save = async (patch: Parameters<typeof authApi.updateProfile>[0]) => {
    const next = await attempt(() => authApi.updateProfile(patch), 'Could not save your profile');
    if (next) setState({ auth: next });
    return next;
  };

  return (
    <Sheet testId="profile-sheet" title="Your profile" subtitle={user.email} onClose={() => setState({ sheet: null })} small>
      <label className="field">
        <span>Name</span>
        <div className="row">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="profile-name" />
          <button
            className="btn"
            disabled={!name.trim() || name.trim() === user.profile.name}
            onClick={async () => (await save({ name: name.trim() })) && toast('Name saved', undefined, 'success')}
          >
            Save
          </button>
        </div>
      </label>
      <AvatarEditor
        name={user.profile.name}
        value={{ avatarStyle: user.profile.avatarStyle, emoji: user.profile.emoji, color: user.profile.color, avatarImage: user.profile.avatarImage }}
        onChange={(v) => save({ ...v, avatarStyle: v.avatarStyle === 'logo' ? 'initials' : v.avatarStyle })}
      />
      {auth.offline && <div className="muted">Offline: you are signed in from this computer. Changes to your name sync when you are back online.</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn danger" data-testid="sign-out" onClick={() => attempt(() => authApi.signOut(), 'Could not sign out')}>
          <Icon.LogOut /> Sign out
        </button>
      </div>
    </Sheet>
  );
}
