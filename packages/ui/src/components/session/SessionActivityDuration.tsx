import React from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useDurationTickerNow } from '@/hooks/useDurationTicker';
import {
  useSessionActivityStartedAt,
  useSessionSettledDurationMs,
} from '@/sync/session-activity-timing';
import { formatSessionActivityDuration } from './sessionActivityDurationFormat';

/** One update per second: the readout is the animation, at 1 fps instead of 60. */
const TICK_MS = 1000;

/**
 * Elapsed time of a session's current turn, or of the turn that just finished.
 * While the turn runs it wears the row's status dot color, so the pair reads as
 * one indicator rather than two; once settled it drops to the neutral row color
 * and lets the unread weight and icon carry that state instead.
 *
 * Deliberately a leaf. The tick re-renders this span alone rather than the
 * session row around it, which is what makes a live counter cheaper than the
 * spinner it replaced — that spinner repainted a composited layer per row every
 * frame for as long as the session ran.
 */
export const SessionActivityDuration: React.FC<{
  sessionId: string;
  /** Turn still running (`busy` or `retry`); false renders the settled total. */
  running: boolean;
  className?: string;
}> = ({ sessionId, running, className }) => {
  const { t } = useI18n();
  const startedAt = useSessionActivityStartedAt(sessionId);
  const settledMs = useSessionSettledDurationMs(sessionId);
  const now = useDurationTickerNow(running, TICK_MS);

  const durationMs = running ? Math.max(0, now - (startedAt ?? now)) : settledMs;
  if (durationMs === undefined) return null;

  const label = formatSessionActivityDuration(durationMs, t);
  const description = running
    ? t('sessions.sidebar.session.status.activeFor', { duration: label })
    : t('sessions.sidebar.session.status.lastTurnDuration', { duration: label });

  return (
    <span
      className={cn(
        'shrink-0 tabular-nums',
        // Green while the turn runs, matching the row's status dot. Once the
        // turn has settled the value rests in the neutral row color: with the
        // unread state now carried by weight and icon, this readout has no
        // color of its own to wear — hue marks the process state only, never
        // the unread state (WCAG 1.4.1).
        running ? 'text-[var(--status-success)]' : 'text-muted-foreground',
        className,
      )}
      aria-label={description}
      title={description}
    >
      {label}
    </span>
  );
};
