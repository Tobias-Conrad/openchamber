import React from 'react';
import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';
import { useI18n } from '@/lib/i18n';
import { useSessionDisplayStore } from '@/stores/useSessionDisplayStore';
import { cn } from '@/lib/utils';

/**
 * What a session row or aggregate is showing: its own turn running
 * (busy/retry), a pause kept open by a background subagent or a background
 * command, or a finished turn the user has not seen.
 */
export type SessionActivityIndicatorState = 'running' | 'subagent' | 'shell' | 'unread';

// Green means "the session is working" (its own turn, a background subagent or
// a background command), always paired with motion or the kind's own icon.
// Unread carries no colour of its own: it is the row's icon plus the bold
// title that mark it (the WhatsApp pattern — colour marks the process state,
// weight marks "unread"). Showing it through a second colour would break WCAG
// 1.4.1, which forbids conveying information by colour alone. Amber belongs to
// the waiting question, which must never be mistaken for a running turn.
const PRESENTATION = {
  running: { icon: 'circle', colorClass: 'text-status-success', labelKey: 'sessions.sidebar.session.status.active' },
  subagent: { icon: 'robot', colorClass: 'text-status-success', labelKey: 'sessions.sidebar.session.status.backgroundSubagent' },
  shell: { icon: 'terminal', colorClass: 'text-status-success', labelKey: 'sessions.sidebar.session.status.backgroundCommand' },
  unread: { icon: 'checkbox-circle', colorClass: 'text-muted-foreground', labelKey: 'sessions.sidebar.session.status.unread' },
} as const satisfies Record<SessionActivityIndicatorState, { icon: IconName; colorClass: string; labelKey: string }>;

/**
 * Live-activity marker for one session row or aggregate. Each state has its
 * own static icon, so a row says why it is busy without motion; motion lives
 * in the 1 Hz elapsed counter (see faa9c243). The opt-in
 * `animatedActivityIndicators` preference replaces every running kind with a
 * `loader-4` spinner stepped to 20 fps (`.activity-spinner`, VS Code's
 * steps() throttling); the unread icon stays.
 */
export const SessionActivityIndicator: React.FC<{
  state: SessionActivityIndicatorState;
  className?: string;
  /** Extra classes for the running kinds only (e.g. the switcher's pulse). */
  runningClassName?: string;
}> = ({ state, className, runningClassName }) => {
  const { t } = useI18n();
  const animated = useSessionDisplayStore((s) => s.animatedActivityIndicators);
  const presentation = PRESENTATION[state];
  const label = t(presentation.labelKey);
  const running = state !== 'unread';

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      aria-label={label}
      title={label}
      data-session-activity-indicator={state}
    >
      {running && animated ? (
        <Icon name="loader-4" className="activity-spinner h-3 w-3 text-status-success" />
      ) : (
        <Icon
          name={presentation.icon}
          className={cn('h-3 w-3', presentation.colorClass, running && runningClassName)}
        />
      )}
    </span>
  );
};
