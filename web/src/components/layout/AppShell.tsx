import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api, qs } from '../../api/client';
import { useLocale } from '../../lib/i18n';
import type { MemoryListResponse } from '../../api/types';
import styles from './AppShell.module.css';

const NAV_ITEMS = [
  { to: '/atlas', key: 'appShell.nav.atlas' },
  { to: '/memories', key: 'appShell.nav.memories' },
  { to: '/injection', key: 'appShell.nav.injection' },
  { to: '/sleep', key: 'appShell.nav.sleep' },
  { to: '/settings', key: 'appShell.nav.settings' }
] as const;

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, locale, setLocale } = useLocale();

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('memweave-theme');
    return stored === 'dark' ? 'dark' : 'light';
  });
  const [query, setQuery] = useState('');
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  // Fetch server version
  useEffect(() => {
    api.get<{ version?: string }>('/health').then((h) => {
      if (h.version) setServerVersion(h.version);
    }).catch(() => { /* fail-silent */ });
  }, []);

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

  const toggleLocale = () => setLocale(locale === 'en' ? 'zh' : 'en');

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
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <span className={styles.sidebarVersion}>
            {t('appShell.version')}{serverVersion ?? '…'}
          </span>
        </div>
      </aside>
      <header className={styles.topbar}>
        <form className={styles.searchForm} onSubmit={onSearchSubmit}>
          <input
            type="search"
            className={styles.search}
            placeholder={t('appShell.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <button
          className={styles.localeToggle}
          onClick={toggleLocale}
          aria-label={locale === 'en' ? 'Switch to Chinese' : 'Switch to English'}
        >
          {locale === 'en' ? '中' : 'EN'}
        </button>
        <button
          className={styles.themeToggle}
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          aria-label={t('appShell.toggleTheme')}
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
