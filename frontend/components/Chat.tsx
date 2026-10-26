'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChatSummary, LawDomain, Message, Mode, RouteInfo, Source, getChat, listDomains, sendMessage,
} from '@/lib/api';
import { BOT_NAME } from '@/lib/brand';
import {
  BookIcon, CheckIcon, CopyIcon, InfoIcon, MenuIcon, RetryIcon, ScaleIcon, SendIcon, SparkIcon,
} from './Icons';
import Markdown from './Markdown';
import ModePicker from './ModePicker';
import ThemeToggle from './ThemeToggle';

const MAX_LEN = 8000;
const MODE_KEY = 'answer-mode'; // remembered choice: { mode, domain }

const SUGGESTIONS: { text: string; kind: 'Law' | 'General' }[] = [
  { text: 'What does the law say about cheating in public examinations?', kind: 'Law' },
  { text: 'What is the punishment for theft?', kind: 'Law' },
  { text: 'Who can be punished for leaking exam question papers?', kind: 'Law' },
  { text: 'Explain how photosynthesis works', kind: 'General' },
];

function RouteBadge({ route }: { route: RouteInfo }) {
  if (route.type === 'law') {
    return (
      <span className="tag law">
        <ScaleIcon size={13} />
        {route.domains.map((d) => d.label).join(' · ') || 'Law databases'}
      </span>
    );
  }
  if (route.type === 'general') {
    return (
      <span className="tag general">
        <SparkIcon size={13} />
        General answer
      </span>
    );
  }
  return (
    <span className="tag unsupported">
      <InfoIcon size={13} />
      Not covered by the law databases
    </span>
  );
}

function Sources({ sources, multiDomain }: { sources: Source[]; multiDomain: boolean }) {
  return (
    <details className="sources">
      <summary>
        <BookIcon size={14} />
        {sources.length} {sources.length === 1 ? 'source' : 'sources'}
      </summary>
      <ol>
        {sources.map((src, i) => (
          <li key={src.id} className="source">
            <div className="source-head">
              <span className="source-num">{i + 1}</span>
              <div className="source-ref">
                <strong>{src.act}</strong>
                <span>
                  {[
                    src.section && `Section ${src.section}`,
                    src.title,
                    src.chapter,
                    multiDomain && src.domain,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              {typeof src.score === 'number' && (
                <span className="score" title="How closely this excerpt matched your question">
                  {Math.round(src.score * 100)}%
                </span>
              )}
            </div>
            {src.excerpt && <p>{src.excerpt}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing useful to do */
    }
  }
  return (
    <button className="icon-btn small" onClick={copy} aria-label="Copy answer" title="Copy answer">
      {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
    </button>
  );
}

type Props = {
  chatId: string | null;
  title: string | null;
  resetKey: number;
  onChatSaved: (c: ChatSummary) => void;
  onBusyChange: (busy: boolean) => void;
  onOpenMenu: () => void;
};

function errorText(e: unknown) {
  return e instanceof TypeError
    ? 'Can’t reach the server. Make sure the backend is running on port 4000.'
    : (e as Error).message;
}

export default function Chat({ chatId, title, resetKey, onChatSaved, onBusyChange, onOpenMenu }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState<{ mode: Mode; domain: string | null } | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('auto');
  const [domain, setDomain] = useState<string | null>(null);
  const [domains, setDomains] = useState<LawDomain[] | null>(null);
  const [domainsError, setDomainsError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // When we create a chat ourselves we already hold its messages: don't reload them.
  const skipLoadFor = useRef<string | null>(null);

  // Restore the last answer mode, then load the law databases for "Specific law".
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(MODE_KEY) ?? 'null');
      if (saved && ['auto', 'general', 'law'].includes(saved.mode)) {
        setMode(saved.mode);
        setDomain(typeof saved.domain === 'string' ? saved.domain : null);
      }
    } catch {
      /* storage unavailable or corrupt: keep Auto */
    }
    listDomains()
      .then(setDomains)
      .catch((e) => setDomainsError(errorText(e)));
  }, []);

  // A remembered law database that no longer exists falls back to Auto.
  useEffect(() => {
    if (domains && mode === 'law' && !domains.some((d) => d.id === domain)) changeMode('auto', null);
  }, [domains, mode, domain]);

  function changeMode(m: Mode, d: string | null) {
    setMode(m);
    setDomain(m === 'law' ? d : null);
    try {
      localStorage.setItem(MODE_KEY, JSON.stringify({ mode: m, domain: m === 'law' ? d : null }));
    } catch {
      /* storage unavailable: the choice still applies for this visit */
    }
    inputRef.current?.focus();
  }

  useEffect(() => {
    onBusyChange(!!sending || loadingChat);
  }, [sending, loadingChat, onBusyChange]);

  useEffect(() => {
    setError(null);
    if (!chatId) {
      setMessages([]);
      inputRef.current?.focus();
      return;
    }
    if (skipLoadFor.current === chatId) {
      skipLoadFor.current = null;
      return;
    }
    let cancelled = false;
    setLoadingChat(true);
    setMessages([]);
    getChat(chatId)
      .then((c) => !cancelled && setMessages(c.messages))
      .catch((e) => !cancelled && setError(errorText(e)))
      .finally(() => !cancelled && setLoadingChat(false));
    return () => {
      cancelled = true;
    };
  }, [chatId, resetKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  // Grow the textarea with its content (up to the CSS max-height).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  async function send(
    text: string,
    base: Message[] = messages,
    how: { mode: Mode; domain: string | null } = { mode, domain },
  ) {
    const content = text.trim();
    if (!content || sending || loadingChat) return;

    setMessages([...base, { role: 'user', content }]);
    setInput('');
    setError(null);
    setSending(how);

    try {
      const data = await sendMessage(chatId, content, how.mode, how.domain);
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: data.reply, sources: data.sources, route: data.route },
      ]);
      if (!chatId) skipLoadFor.current = data.chatId;
      onChatSaved({ id: data.chatId, title: data.title, updatedAt: data.updatedAt });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(null);
      inputRef.current?.focus();
    }
  }

  function retry() {
    const last = messages[messages.length - 1];
    if (last?.role !== 'user') return;
    const base = messages.slice(0, -1);
    send(last.content, base);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  }

  const canRetry = error && messages[messages.length - 1]?.role === 'user';
  const busy = !!sending || loadingChat;
  const nearLimit = input.length > MAX_LEN * 0.9;

  return (
    <div className="shell">
      <header className="bar">
        <button className="icon-btn menu-btn" onClick={onOpenMenu} aria-label="Open chat history">
          <MenuIcon />
        </button>
        <h1 title={title ?? undefined}>{chatId ? title ?? 'Chat' : 'New chat'}</h1>
        <ThemeToggle />
      </header>

      <main className="thread" aria-live="polite" aria-busy={busy}>
        {loadingChat && (
          <div className="skeleton" aria-label="Loading chat">
            <span className="sk sk-user" />
            <span className="sk sk-bot" />
            <span className="sk sk-bot short" />
          </div>
        )}

        {!loadingChat && messages.length === 0 && !error && (
          <section className="empty">
            <div className="empty-mark">
              <ScaleIcon size={28} />
            </div>
            <h2>Hi, I’m {BOT_NAME}. Ask about Bangladesh law, or anything else.</h2>
            <p>
              Legal answers come only from the Acts in the law databases and cite the sections
              they used. Everything else is answered by a general assistant.
            </p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.text}
                  className="chip"
                  onClick={() => send(s.text, messages, { mode: 'auto', domain: null })}
                >
                  <span className={`chip-kind ${s.kind.toLowerCase()}`}>
                    {s.kind === 'Law' ? <ScaleIcon size={13} /> : <SparkIcon size={13} />}
                    {s.kind}
                  </span>
                  <span className="chip-text">{s.text}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="msg user">
              <div className="bubble">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="msg assistant">
              <div className="avatar-bot" aria-hidden="true">
                <ScaleIcon size={16} />
              </div>
              <div className="col">
                <div className="answer">
                  <Markdown text={m.content} />
                </div>
                <div className="meta">
                  {m.route && <RouteBadge route={m.route} />}
                  <CopyButton text={m.content} />
                </div>
                {m.sources && m.sources.length > 0 && (
                  <Sources
                    sources={m.sources}
                    multiDomain={!!m.route && m.route.domains.length > 1}
                  />
                )}
              </div>
            </div>
          ),
        )}

        {sending && (
          <div className="msg assistant" role="status">
            <div className="avatar-bot" aria-hidden="true">
              <ScaleIcon size={16} />
            </div>
            <div className="thinking">
              <span className="dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {sending.mode === 'law'
                ? `Searching ${domains?.find((d) => d.id === sending.domain)?.label ?? 'the law database'}…`
                : 'Thinking…'}
            </div>
          </div>
        )}

        {error && (
          <div className="error" role="alert">
            <InfoIcon size={18} />
            <span className="error-text">{error}</span>
            {canRetry && (
              <button className="ghost" onClick={retry}>
                <RetryIcon size={14} />
                Retry
              </button>
            )}
          </div>
        )}
      </main>

      <div className="dock">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <ModePicker
            mode={mode}
            domain={domain}
            domains={domains}
            domainsError={domainsError}
            disabled={!!sending}
            onChange={changeMode}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              mode === 'law'
                ? `Ask ${BOT_NAME} about ${domains?.find((d) => d.id === domain)?.label ?? 'this law'}…`
                : `Message ${BOT_NAME}…`
            }
            rows={1}
            maxLength={MAX_LEN}
            aria-label="Message"
          />
          <button
            type="submit"
            className="send"
            disabled={busy || !input.trim()}
            aria-label="Send message"
            title="Send (Enter)"
          >
            <SendIcon size={18} />
          </button>
        </form>
        <p className="note">
          {nearLimit ? (
            <span className="count">
              {input.length.toLocaleString()} / {MAX_LEN.toLocaleString()} characters
            </span>
          ) : (
            <>
              <span className="kbd-hint">
                <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line ·{' '}
              </span>
              General information only, not legal advice.
            </>
          )}
        </p>
      </div>
      <div ref={endRef} />
    </div>
  );
}
