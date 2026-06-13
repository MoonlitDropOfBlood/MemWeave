/**
 * Stub for the Injection page.
 *
 * The full plan (Task 8) calls for a request-preview form, a bundle viewer,
 * and a contextXml preview with a copy button. v1 ships the minimum: a
 * form that POSTs to /api/v1/inject and renders the response.
 */
import { useState } from 'react';
import { ApiError, api } from '../api/client';
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
        <h1 className={styles.title}>Injection</h1>
        <p className={styles.subtitle}>Audit what the agent would see</p>
      </header>

      <div className={styles.split}>
        <form className={styles.form} onSubmit={onSubmit}>
          <h2 className={styles.formTitle}>Request a preview</h2>

          <label className={styles.field}>
            <span>Phase</span>
            <select value={phase} onChange={(e) => setPhase(e.target.value as typeof PHASES[number])}>
              {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          <label className={styles.field}>
            <span>Session ID</span>
            <input type="text" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
          </label>

          <label className={styles.field}>
            <span>Query</span>
            <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={3} />
          </label>

          <label className={styles.field}>
            <span>Files (comma-separated, optional)</span>
            <input type="text" value={files} onChange={(e) => setFiles(e.target.value)} />
          </label>

          <button type="submit" disabled={loading} className={styles.submit}>
            {loading ? 'Computing…' : 'Preview injection bundle'}
          </button>

          {error && <div className={styles.error}>{error}</div>}
        </form>

        <section className={styles.viewer}>
          {response ? (
            <>
              <div className={styles.viewerMeta}>
                <Row k="Bundle ID" v={response.bundleId} />
                <Row k="Phase" v={response.phase} />
                <Row k="Content hash" v={response.contentHash} mono />
                <Row k="Memories" v={response.memoryIds.length.toString()} />
                <Row k="Estimated tokens" v={response.estimatedTokens.toString()} />
              </div>
              <h3 className={styles.viewerSubTitle}>Context XML</h3>
              <pre className={styles.xml}>{response.contextXml}</pre>
            </>
          ) : (
            <div className={styles.empty}>Submit the form to preview an injection bundle.</div>
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
