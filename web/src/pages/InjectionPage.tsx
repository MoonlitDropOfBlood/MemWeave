/**
 * Stub for the Injection page.
 *
 * The full plan (Task 8) calls for a request-preview form, a bundle viewer,
 * and a contextXml preview with a copy button. v1 ships the minimum: a
 * form that POSTs to /api/v1/inject and renders the response.
 */
import { useState } from 'react';
import { ApiError, api } from '../api/client';
import { useLocale } from '../lib/i18n';
import { Dropdown } from '../components/common/Dropdown';
import styles from './InjectionPage.module.css';

interface InjectResponse {
  bundleId: string;
  phase: string;
  memoryIds: string[];
  contentHash: string;
  estimatedTokens: number;
  contextXml: string;
}

const PHASES = ['session_start', 'prompt_delta', 'file_pack', 'failure_delta'] as const;

export function InjectionPage() {
  const { t } = useLocale();
  const [phase, setPhase] = useState<typeof PHASES[number]>('prompt_delta');
  const [sessionId, setSessionId] = useState('demo-session');
  const [query, setQuery] = useState('SQLite design');
  const [files, setFiles] = useState('');
  const [response, setResponse] = useState<InjectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { sessionId, phase, query };
      if (files.trim()) {
        body.files = files.split(',').map((s) => s.trim()).filter(Boolean);
      }
      const r = await api.post<InjectResponse>('/inject', body);
      setResponse(r);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status}: ${JSON.stringify(err.body)}` : (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('injectionPage.title')}</h1>
        <p className={styles.subtitle}>{t('injectionPage.subtitle')}</p>
      </header>

      <div className={styles.split}>
        <form className={styles.form} onSubmit={onSubmit}>
          <h2 className={styles.formTitle}>{t('injectionPage.formTitle')}</h2>

          <label className={styles.field}>
            <span>{t('injectionPage.field.phase')}</span>
            <Dropdown
              value={phase}
              onChange={(v) => setPhase(v as typeof PHASES[number])}
              options={PHASES.map((p) => ({ value: p, label: p }))}
            />
          </label>

          <label className={styles.field}>
            <span>{t('injectionPage.field.sessionId')}</span>
            <input type="text" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
          </label>

          <label className={styles.field}>
            <span>{t('injectionPage.field.query')}</span>
            <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={3} />
          </label>

          <label className={styles.field}>
            <span>{t('injectionPage.field.files')}</span>
            <input type="text" value={files} onChange={(e) => setFiles(e.target.value)} />
          </label>

          <button type="submit" disabled={loading} className={styles.submit}>
            {loading ? t('injectionPage.computing') : t('injectionPage.submit')}
          </button>

          {error && <div className={styles.error}>{error}</div>}
        </form>

        <section className={styles.viewer}>
          {response ? (
            <>
              <div className={styles.viewerMeta}>
                <Row k={t('injectionPage.meta.bundleId')} v={response.bundleId} />
                <Row k={t('injectionPage.meta.phase')} v={response.phase} />
                <Row k={t('injectionPage.meta.contentHash')} v={response.contentHash} mono />
                <Row k={t('injectionPage.meta.memories')} v={response.memoryIds.length.toString()} />
                <Row k={t('injectionPage.meta.estimatedTokens')} v={response.estimatedTokens.toString()} />
              </div>
              <h3 className={styles.viewerSubTitle}>{t('injectionPage.sectionXml')}</h3>
              <pre className={styles.xml}>{response.contextXml}</pre>
            </>
          ) : (
            <div className={styles.empty}>{t('injectionPage.empty')}</div>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className={styles.metaRow}>
      <span className={styles.metaKey}>{k}</span>
      <span className={mono ? `${styles.metaVal} ${styles.metaValMono}` : styles.metaVal}>{v}</span>
    </div>
  );
}
