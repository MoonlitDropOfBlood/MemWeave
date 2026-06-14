import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { useLocale } from '../lib/i18n';
import { Dropdown } from '../components/common/Dropdown';
import type { Device, DeviceCreateResponse, Settings } from '../api/types';
import { formatDate } from '../lib/format';
import styles from './SettingsPage.module.css';

export function SettingsPage() {
  const { t } = useLocale();
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
        <h1 className={styles.title}>{t('settingsPage.title')}</h1>
        <p className={styles.subtitle}>{t('settingsPage.subtitle')}</p>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settingsPage.section.server')}</h2>
        {settingsQ.isLoading ? (
          <div className={styles.loading}><span className="spinner" /> {t('settingsPage.loading')}</div>
        ) : settingsQ.error ? (
          <div className={styles.error}>{t('settingsPage.error')} {(settingsQ.error as Error).message}</div>
        ) : settingsQ.data ? (
          <dl className={styles.dl}>
            <Row k={t('settingsPage.server.host')} v={settingsQ.data.server.host} />
            <Row k={t('settingsPage.server.port')} v={settingsQ.data.server.port.toString()} />
            <Row k={t('settingsPage.server.dbPath')} v={settingsQ.data.storage.path} mono />
            <Row
              k={t('settingsPage.server.embedding')}
              v={`${settingsQ.data.embedding.provider} (${settingsQ.data.embedding.model}, ${settingsQ.data.embedding.dimensions}d)${settingsQ.data.embedding.isConfigured ? '' : ' ' + t('settingsPage.server.notConfigured')}`}
            />
            <Row
              k={t('settingsPage.server.llm')}
              v={`${settingsQ.data.llm.provider} (${settingsQ.data.llm.model})${settingsQ.data.llm.isConfigured ? '' : ' ' + t('settingsPage.server.notConfigured')}`}
            />
            <Row k={t('settingsPage.server.consolidation')} v={settingsQ.data.consolidation.enabled ? `${t('settingsPage.server.every')} ${settingsQ.data.consolidation.intervalHours}h` : t('settingsPage.server.disabled')} />
            <Row k={t('settingsPage.server.authRequired')} v={settingsQ.data.auth.requireAuth ? t('settingsPage.server.yes') : t('settingsPage.server.noDevMode')} />
          </dl>
        ) : null}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{t('settingsPage.section.devices')}</h2>
          <button className={styles.btnPrimary} onClick={() => setShowDialog(true)}>{t('settingsPage.registerDevice')}</button>
        </div>
        {devicesQ.isLoading ? (
          <div className={styles.loading}><span className="spinner" /> {t('settingsPage.loading')}</div>
        ) : (devicesQ.data?.devices.length ?? 0) === 0 ? (
          <div className={styles.empty}>{t('settingsPage.emptyDevices')}</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>{t('settingsPage.table.name')}</th><th>{t('settingsPage.table.type')}</th><th>{t('settingsPage.table.registered')}</th><th>{t('settingsPage.table.lastSeen')}</th><th></th></tr>
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
                        if (confirm(t('settingsPage.confirmRevoke', { name: d.name }))) revoke.mutate(d.id);
                      }}
                    >{t('settingsPage.revoke')}</button>
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
                <h3 className={styles.dialogTitle}>{t('settingsPage.dialog.title')}</h3>
                <label className={styles.field}>
                  <span>{t('settingsPage.dialog.name')}</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="laptop-1" required />
                </label>
                <label className={styles.field}>
                  <span>{t('settingsPage.dialog.type')}</span>
                  <Dropdown
                    value={type}
                    onChange={(v) => setType(v as typeof type)}
                    size="sm"
                    options={[
                      { value: 'opencode',    label: 'opencode' },
                      { value: 'cursor',      label: 'cursor' },
                      { value: 'claude_code', label: 'claude_code' },
                      { value: 'rest',        label: 'rest' }
                    ]}
                  />
                </label>
                <div className={styles.dialogActions}>
                  <button type="button" onClick={() => setShowDialog(false)} className={styles.btnSecondary}>{t('settingsPage.dialog.cancel')}</button>
                  <button type="submit" className={styles.btnPrimary} disabled={create.isPending}>
                    {create.isPending ? t('settingsPage.dialog.creating') : t('settingsPage.dialog.create')}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <h3 className={styles.dialogTitle}>{t('settingsPage.dialog.created')}</h3>
                <p className={styles.warning}>{create.data.notice}</p>
                <label className={styles.field}>
                  <span>{t('settingsPage.dialog.apiKey')}</span>
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
                  >{t('settingsPage.dialog.copy')}</button>
                  <button type="button" onClick={() => { setShowDialog(false); setName(''); create.reset(); }} className={styles.btnPrimary}>
                    {t('settingsPage.dialog.done')}
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
