import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api, qs } from '../../api/client';
import type { MemoryListResponse } from '../../api/types';
import styles from './AppShell.module.css';

const NAV_ITEMS = [
  { to: '/atlas', label: 'Atlas' },
  { to: '/memories', label: 'Memories' },
  { to: '/injection', label: 'Injection' },
  { to: '/sleep', label: 'Sleep' },
  { to: '/settings', label: 'Settings' }
] as const;

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('memweave-theme');
    return stored === 'dark' ? 'dark' : 'light';
  });
  const [query, setQuery] = useState('');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('memweave-theme', theme);
  }, [theme]);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/memories?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>MemWeave</div>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <span className={styles.sidebarVersion}>v0.1.0</span>
        </div>
      </aside>
      <header className={styles.topbar}>
        <form className={styles.searchForm} onSubmit={onSearchSubmit}>
          <input
            type="search"
            className={styles.search}
            placeholder="Search memories…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <button
          className={styles.themeToggle}
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          aria-label="Toggle theme"
        >
          {theme === 'light' ? '◐' : '◑'}
        </button>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

// Re-export the helper so the pages don't need to import from two places.
export { api, ApiError, qs, Link, useNavigate };
export type { MemoryListResponse };
