/**
 * Custom Dropdown — replaces native <select> to avoid OS-rendered
 * dark-flash on Windows when the popup opens.
 *
 * API mirrors a controlled <select>:
 *   <Dropdown value={phase} onChange={setPhase} options={[...]} />
 */
import { useEffect, useId, useRef, useState } from 'react';
import styles from './Dropdown.module.css';

export interface DropdownOption<V extends string = string> {
  value: V;
  label: string;
}

export function Dropdown<V extends string = string>({
  value,
  onChange,
  options,
  placeholder,
  size = 'md'
}: {
  value: V | '';
  onChange: (v: V) => void;
  options: ReadonlyArray<DropdownOption<V>>;
  placeholder?: string;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(() =>
    Math.max(0, options.findIndex((o) => o.value === value))
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const current = options.find((o) => o.value === value);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      buttonRef.current?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowDown' || (e.key === 'ArrowUp' && !open)) {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIdx((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) {
        const opt = options[activeIdx];
        if (opt) {
          onChange(opt.value);
          setOpen(false);
          buttonRef.current?.focus();
        }
      } else {
        setOpen(true);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.wrap} ${size === 'sm' ? styles.sm : styles.md}`}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        <span className={current ? styles.value : styles.placeholder}>
          {current ? current.label : (placeholder ?? '')}
        </span>
        <span className={styles.chev} aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className={styles.list}
          onKeyDown={onKey}
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isActive = i === activeIdx;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className={[
                  styles.option,
                  isSelected ? styles.optionSelected : '',
                  isActive ? styles.optionActive : ''
                ].join(' ')}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                {opt.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
