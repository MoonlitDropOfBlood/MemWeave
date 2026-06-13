import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import type { Device, DeviceCreateResponse, Settings } from '../api/types';
import { formatDate } from '../lib/format';
import styles from './SettingsPage.module.css';

export function SettingsPage() {
  const settingsQ = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: () => api.get<Settings>('/settings')
  });
  const devicesQ = useQuery<{ devices: Device[]; total: number }>({
    queryKey: ['devices'],
    queryFn: () => api.get('/devices')
  });
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: (input: { name: string; type: string }) => api.post<DeviceCreateResponse>('/devices', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] })
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/devices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] })
  });

  const [showDialog, setShowDialog] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'opencode' | 'cursor' | 'claude_code' | 'rest'>('opencode');

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({ name: name.trim(), type });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Server configuration and registered devices</p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Server</h2>
        {settingsQ.isLoading ? (
          <div className={styles.loading}><span className="spinner" /> Loading…</div>
        ) : settingsQ.error ? (
          <div className={styles.error}>Failed to load: {(settingsQ.error as Error).message}</div>
        ) : settingsQ.data ? (
          <dl className={styles.dl}>
            <Row k="Host" v={settingsQ.data.server.host} />
            <Row k="Port" v={settingsQ.data.server.port.toString()} />
            <Row k="DB path" v={settingsQ.data.storage.path} mono />
            <Row k="Embedding provider" v={`${settingsQ.data.embedding.provider} (${settingsQ.data.embedding.model}, ${settingsQ.data.embedding.dimensions}d)`} />
            <Row k="LLM provider" v={`${settingsQ.data.llm.provider} (${settingsQ.data.llm.model})`} />
            <Row k="Consolidation" v={settingsQ.data.consolidation.enabled ? `every ${settingsQ.data.consolidation.intervalHours}h` : 'disabled'} />
            <Row k="Auth required" v={settingsQ.data.auth.requireAuth ? 'yes' : 'no (dev mode)'} />
          </dl>
        ) : null}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Devices</h2>
          <button className={styles.btnPrimary} onClick={() => setShowDialog(true)}>+ Register device</button>
        </div>
        {devicesQ.isLoading ? (
          <div className={styles.loading}><span className="spinner" /> Loading…</div>
        ) : (devicesQ.data?.devices.length ?? 0) === 0 ? (
          <div className={styles.empty}>No devices registered yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Name</th><th>Type</th><th>Registered</th><th>Last seen</th><th></th></tr>
            </thead>
            <tbody>
              {devicesQ.data!.devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.type}</td>
                  <td>{formatDate(d.registeredAt)}</td>
                  <td>{formatDate(d.lastSeenAt)}</td>
                  <td>
                    <button
                      className={styles.btnDanger}
                      onClick={() => {
                        if (confirm(`Revoke device "${d.name}"?`)) revoke.mutate(d.id);
                      }}
                    >Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showDialog && (
        <div className={styles.dialogBackdrop} onClick={() => setShowDialog(false)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            {!create.data ? (
              <form onSubmit={onCreate}>
                <h3 className={styles.dialogTitle}>Register a new device</h3>
                <label className={styles.field}>
                  <span>Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="laptop-1" required />
                </label>
                <label className={styles.field}>
                  <span>Type</span>
                  <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                    <option value="opencode">opencode</option>
                    <option value="cursor">cursor</option>
                    <option value="claude_code">claude_code</option>
                    <option value="rest">rest</option>
                  </select>
                </label>
                <div className={styles.dialogActions}>
                  <button type="button" onClick={() => setShowDialog(false)} className={styles.btnSecondary}>Cancel</button>
                  <button type="submit" className={styles.btnPrimary} disabled={create.isPending}>
                    {create.isPending ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <h3 className={styles.dialogTitle}>Device created</h3>
                <p className={styles.warning}>{create.data.notice}</p>
                <label className={styles.field}>
                  <span>API key (copy now — won't be shown again)</span>
                  <input
                    value={create.data.apiKey}
                    readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                </label>
                <div className={styles.dialogActions}>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(create.data!.apiKey)}
                    className={styles.btnSecondary}
                  >Copy</button>
                  <button type="button" onClick={() => { setShowDialog(false); setName(''); create.reset(); }} className={styles.btnPrimary}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className={styles.dlRow}>
      <span className={styles.dlKey}>{k}</span>
      <span className={mono ? `${styles.dlVal} ${styles.dlMono}` : styles.dlVal}>{v}</span>
    </div>
  );
}
