'use client';

import type { ChatSummary } from '@/lib/api';
import { BOT_NAME } from '@/lib/brand';
import { useAuth } from './AuthProvider';
import { CloseIcon, LogoutIcon, PlusIcon, ScaleIcon, TrashIcon } from './Icons';

type Props = {
  chats: ChatSummary[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  open: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

/** Today / Yesterday / Previous 7 days / Previous 30 days / Older, keeping list order. */
function group(chats: ChatSummary[]) {
  const day = 86_400_000;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const label = (t: number) =>
    t >= startOfToday ? 'Today'
    : t >= startOfToday - day ? 'Yesterday'
    : t >= startOfToday - 7 * day ? 'Previous 7 days'
    : t >= startOfToday - 30 * day ? 'Previous 30 days'
    : 'Older';

  const groups: { label: string; chats: ChatSummary[] }[] = [];
  for (const c of chats) {
    const l = label(c.updatedAt ?? 0);
    const last = groups[groups.length - 1];
    if (last?.label === l) last.chats.push(c);
    else groups.push({ label: l, chats: [c] });
  }
  return groups;
}

export default function Sidebar({
  chats, activeId, loading, error, busy, open, onSelect, onNew, onDelete, onClose,
}: Props) {
  const { user, logout } = useAuth();
  const name = user?.displayName || user?.email || 'Account';

  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Chat history">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <ScaleIcon size={18} />
        </span>
        <span className="brand-name">
          {BOT_NAME}
          <small>Bangladesh law assistant</small>
        </span>
        <button className="icon-btn drawer-close" onClick={onClose} aria-label="Close chat history">
          <CloseIcon />
        </button>
      </div>

      <div className="side-top">
        <button className="new-chat" onClick={onNew} disabled={busy}>
          <PlusIcon size={16} />
          New chat
        </button>
      </div>

      <nav className="chat-list">
        {loading && (
          <div className="side-skeleton" aria-label="Loading chats">
            <span /><span /><span />
          </div>
        )}
        {error && <p className="side-note err">{error}</p>}
        {!loading && !error && chats.length === 0 && (
          <p className="side-note">No chats yet. Your conversations will show up here.</p>
        )}
        {group(chats).map((g) => (
          <section key={g.label} className="chat-group">
            <h2>{g.label}</h2>
            <ul>
              {g.chats.map((c) => (
                <li key={c.id} className={`chat-item${c.id === activeId ? ' active' : ''}`}>
                  <button
                    className="open-chat"
                    onClick={() => onSelect(c.id)}
                    disabled={busy}
                    title={c.title}
                    aria-current={c.id === activeId ? 'page' : undefined}
                  >
                    {c.title}
                  </button>
                  <button
                    className="del"
                    onClick={() => onDelete(c.id)}
                    disabled={busy}
                    aria-label={`Delete chat: ${c.title}`}
                    title="Delete chat"
                  >
                    <TrashIcon size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <div className="side-user">
        {user?.photoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="avatar fallback" aria-hidden="true">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="who">
          <strong>{name}</strong>
          {user?.displayName && user?.email && <span>{user.email}</span>}
        </div>
        <button className="icon-btn" onClick={() => logout()} aria-label="Log out" title="Log out">
          <LogoutIcon size={17} />
        </button>
      </div>
    </aside>
  );
}
