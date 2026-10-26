'use client';

import { useEffect, useRef, useState } from 'react';
import type { LawDomain, Mode } from '@/lib/api';
import { CheckIcon, ChevronIcon, InfoIcon, ScaleIcon, SparkIcon } from './Icons';

type Props = {
  mode: Mode;
  domain: string | null;
  domains: LawDomain[] | null; // null = still loading
  domainsError: string | null;
  disabled?: boolean;
  onChange: (mode: Mode, domain: string | null) => void;
};

function Item({ m, d, icon, title, hint, active, onPick }: {
  m: Mode; d: string | null; icon: React.ReactNode; title: string; hint?: string;
  active: boolean; onPick: (m: Mode, d: string | null) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={`mode-item${active ? ' active' : ''}`}
      onClick={() => onPick(m, d)}
    >
      <span className="mode-icon">{icon}</span>
      <span className="mode-text">
        <strong>{title}</strong>
        {hint && <small>{hint}</small>}
      </span>
      {active && <CheckIcon size={15} className="mode-check" />}
    </button>
  );
}

export default function ModePicker({ mode, domain, domains, domainsError, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const current = mode === 'law' ? domains?.find((d) => d.id === domain) : undefined;
  const label = mode === 'general' ? 'General' : mode === 'law' ? current?.label ?? 'Specific law' : 'Auto';

  // Close on outside click; focus the selected item when opening.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    const checked = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (checked ?? items?.[0])?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function pick(m: Mode, d: string | null) {
    onChange(m, d);
    setOpen(false);
    btnRef.current?.focus();
  }

  function onMenuKey(e: React.KeyboardEvent) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className="mode" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`mode-btn ${mode}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose how your question is answered"
      >
        {mode === 'general' ? <SparkIcon size={14} /> : mode === 'law' ? <ScaleIcon size={14} /> : <InfoIcon size={14} />}
        <span className="mode-label">{label}</span>
        <ChevronIcon size={13} className="mode-chev" />
      </button>

      {open && (
        <div className="mode-menu" role="menu" aria-label="Answer mode" ref={menuRef} onKeyDown={onMenuKey}>
          <Item m="auto" d={null} active={mode === 'auto'} onPick={pick} icon={<InfoIcon size={16} />} title="Auto"
                hint="Detects whether it’s legal and which law to search" />
          <Item m="general" d={null} active={mode === 'general'} onPick={pick} icon={<SparkIcon size={16} />} title="General"
                hint="Answer directly with Gemini, no law search" />

          <div className="mode-group" role="presentation">Specific law</div>
          {domains === null && !domainsError && <p className="mode-note">Loading law databases…</p>}
          {domainsError && <p className="mode-note err">{domainsError}</p>}
          {domains && domains.length === 0 && <p className="mode-note">No law databases yet.</p>}
          {domains?.map((d) => (
            <Item key={d.id} m="law" d={d.id} active={mode === 'law' && domain === d.id} onPick={pick} icon={<ScaleIcon size={16} />} title={d.label}
                  hint={d.description || 'Search only this law database'} />
          ))}
        </div>
      )}
    </div>
  );
}
