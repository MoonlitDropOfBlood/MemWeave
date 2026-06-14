import { useLocale } from '../lib/i18n';

export function NotFoundPage() {
  const { t } = useLocale();
  return (
    <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.message')}</p>
      <a href="/ui/">{t('notFound.back')}</a>
    </div>
  );
}
