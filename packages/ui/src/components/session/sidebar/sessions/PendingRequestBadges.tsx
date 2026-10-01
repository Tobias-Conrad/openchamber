import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * The pending-permission and pending-question badges of a session row. One
 * component for every layout — the project rows, the timeline rows, and the
 * waiting rows the top zone lifts — so the markup and the labels can never
 * drift apart between surfaces.
 */
export const PendingRequestBadges: React.FC<{
  permissionCount: number;
  formCount: number;
  /** Visibility/reveal classes of the row layout the badges sit in. */
  className?: string;
}> = ({ permissionCount, formCount, className }) => {
  const { t } = useI18n();
  if (permissionCount <= 0 && formCount <= 0) return null;
  const permissionLabel = t('sessions.sidebar.session.status.permissionRequired');
  const formLabel = formCount === 1
    ? t('sessions.sidebar.session.status.questionPendingSingle')
    : t('sessions.sidebar.session.status.questionPendingMany', { count: formCount });
  return (
    <>
      {permissionCount > 0 ? (
        <span className={cn('inline-flex flex-shrink-0 items-center gap-1 rounded bg-destructive/10 px-1 py-0.5 text-[0.7rem] text-destructive', className)} title={permissionLabel} aria-label={permissionLabel}>
          <Icon name="shield" className="h-3 w-3" />
          <span className="leading-none">{permissionCount}</span>
        </span>
      ) : null}
      {formCount > 0 ? (
        <span className={cn('inline-flex flex-shrink-0 items-center gap-1 rounded bg-status-info/10 px-1 py-0.5 text-[0.7rem] text-status-info', className)} title={formLabel} aria-label={formLabel}>
          <Icon name="question" className="h-3 w-3" />
          <span className="leading-none">{formCount}</span>
        </span>
      ) : null}
    </>
  );
};
