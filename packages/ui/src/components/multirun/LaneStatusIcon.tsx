import React from 'react';
import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';
import { useI18n } from '@/lib/i18n';
import { LANE_STATUS_LABEL_KEYS, type LaneStatus } from '@/lib/multirun/laneStatus';
import { cn } from '@/lib/utils';

// One status vocabulary across the app (see SessionActivityIndicator):
//   green  = the lane is working (its own turn runs);
//   amber  = the lane waits on the user (an open question) or ended without an
//            answer;
//   red    = it needs a decision now (permission) or the turn failed;
//   grey   = flat facts that ask for nothing (stopped, not started, finished);
//   weight = "unread", which is the row's job, never this icon's colour.
// Blocked states reuse the sidebar's glyphs and colors, so a lane waiting on
// the user reads the same here as its row does there. A plain finish stays
// grey: it only means the turn ended, not that the work is good.
const STATUS_ICON = {
  // The permission shield is the app's established stop sign (the sidebar and
  // the mobile row paint it destructive too), so it keeps red rather than the
  // amber reserved for questions.
  permission: { name: 'shield', className: 'text-destructive' },
  question: { name: 'question', className: 'text-status-warning' },
  working: { name: 'loader-4', className: 'animate-spin text-status-success' },
  failed: { name: 'error-warning', className: 'text-[var(--status-error)]' },
  stopped: { name: 'stop', className: 'text-muted-foreground' },
  notStarted: { name: 'time', className: 'text-muted-foreground' },
  // Ended with no answer: the lane also waits on a human, so it keeps the
  // same amber as the question (the token is the one `text-status-warning`
  // resolves to).
  noReply: { name: 'alert', className: 'text-[var(--status-warning)]' },
  finished: { name: 'checkbox-circle', className: 'text-muted-foreground' },
} satisfies Record<LaneStatus, { name: IconName; className: string }>;

export function LaneStatusIcon({ status, className }: { status: LaneStatus; className?: string }): React.ReactNode {
  const { t } = useI18n();
  const icon = STATUS_ICON[status];
  const label = t(LANE_STATUS_LABEL_KEYS[status]);
  return (
    <span className="inline-flex shrink-0" title={label}>
      <Icon name={icon.name} className={cn('size-3.5', icon.className, className)} aria-label={label} />
    </span>
  );
}
