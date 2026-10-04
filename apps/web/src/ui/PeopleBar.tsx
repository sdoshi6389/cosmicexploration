import { Eye, Radio, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { STOP_BY_ID, type StopId } from '../navigation/stops';
import { useUi } from '../state/ui';
import { colorFor, useWorld } from '../state/world';

/**
 * Multiplayer bar: who is in this world, where they are, one-click jump to their
 * view, follow the presenter, and invite someone (editor link).
 */
export function PeopleBar() {
  const mode = useWorld((s) => s.mode);
  const members = useWorld((s) => s.members);
  const poses = useWorld((s) => s.poses);
  const me = useWorld((s) => s.identityHex);
  const invites = useWorld((s) => s.invites);
  const presenterHex = useWorld((s) => s.presenterHex);
  const following = useWorld((s) => s.following);
  const role = useWorld((s) => s.role);
  const goTo = useUi((s) => s.goTo);
  const jumpTo = useUi((s) => s.jumpTo);
  const toast = useUi((s) => s.toast);
  const [copied, setCopied] = useState(false);
  if (mode !== 'live') return null;
  const others = members.filter((m) => m.identityHex !== me);
  const editor = invites.find((i) => i.role === 'editor');
  const invite = () => {
    if (!editor) return;
    const url = `${window.location.origin}${window.location.pathname}?join=${editor.code}`;
    void navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    toast({ kind: 'success', title: 'Invite link copied', body: 'Anyone who opens it joins this world as an editor.' });
  };
  const presenting = presenterHex === me;
  return (
    <div className="glass" style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', maxWidth: '44vw', overflowX: 'auto' }}>
      <span style={{ width: 10, height: 10, borderRadius: 10, background: colorFor(me ?? ''), boxShadow: `0 0 8px ${colorFor(me ?? '')}` }} title="You" />
      {others.map((m) => {
        const pose = poses.find((p) => p.identityHex === m.identityHex);
        const where = STOP_BY_ID[(pose?.stop ?? m.stop) as StopId]?.name ?? '—';
        return (
          <button
            key={m.identityHex} type="button" className="btn sm" disabled={!m.online}
            title={`${m.displayName} · ${m.online ? where : 'offline'} — click to jump to their view`}
            onClick={() => {
              if (!pose) return;
              goTo(pose.stop as StopId);
              jumpTo(pose.stop, pose.position, pose.target);
            }}
            style={{ gap: 6, borderColor: m.online ? colorFor(m.identityHex) : undefined, opacity: m.online ? 1 : 0.5 }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 8, background: colorFor(m.identityHex) }} />
            <span style={{ fontSize: 11.5 }}>{m.displayName}</span>
            <span className="faint" style={{ fontSize: 10 }}>{m.online ? where : 'offline'}</span>
            {m.identityHex === presenterHex ? <Radio size={11} /> : null}
          </button>
        );
      })}
      {presenterHex && !presenting ? (
        <button type="button" className={`btn sm ${following ? 'primary' : ''}`} onClick={() => useWorld.getState().setFollowing(!following)} title="Follow the presenter">
          <Eye size={12} /> {following ? 'Following' : 'Follow'}
        </button>
      ) : null}
      {role !== 'viewer' ? (
        <button type="button" className={`btn sm ${presenting ? 'primary' : 'ghost'}`} onClick={() => useWorld.getState().setPresenter(!presenting)} title="Others can follow your view">
          <Radio size={12} /> {presenting ? 'Presenting' : 'Present'}
        </button>
      ) : null}
      {editor ? (
        <button type="button" className="btn sm primary" onClick={invite}><UserPlus size={12} /> {copied ? 'Copied' : 'Invite'}</button>
      ) : null}
    </div>
  );
}

/** First visit: ask for the name other explorers will see. */
export function NamePrompt() {
  const mode = useWorld((s) => s.mode);
  const name = useWorld((s) => s.displayName);
  const [v, setV] = useState('');
  if (mode !== 'live' || name) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 80, display: 'grid', placeItems: 'center', background: 'rgba(2,4,10,0.55)' }}>
      <form
        className="glass brackets" style={{ width: 'min(380px, 92vw)', padding: 22 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim()) useWorld.getState().setDisplayName(v);
        }}
      >
        <div className="display" style={{ fontSize: 14, letterSpacing: '0.2em', marginBottom: 6 }}>WELCOME, EXPLORER</div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>What should other explorers in this world call you?</div>
        <input className="text-input" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="Your name" style={{ width: '100%', marginBottom: 12 }} />
        <button type="submit" className="btn primary" style={{ width: '100%' }} disabled={!v.trim()}>Enter the cosmos</button>
      </form>
    </div>
  );
}
