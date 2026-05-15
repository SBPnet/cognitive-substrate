import { OperationalSignal, OperationalPayload } from '@cognitive-substrate/core-types';

import { v4 as uuidv4 } from 'uuid';

/**
 * Synthetic operational data generator for Exp 12.
 * Generates correlated signals across 4 windows.
 */
export function generateOperationalBatch(
  window: 'normal' | 'degraded' | 'outage' | 'recovery',
  count: number = 50,
  baseTime: Date = new Date('2026-05-14T10:00:00Z')
): OperationalSignal[] {
  const signals: OperationalSignal[] = [];
  const services = ['postgres-prod', 'redis-cache', 'clickhouse-analytics'];

  for (let i = 0; i < count; i++) {
    const offsetMinutes = i * (window === 'outage' ? 0.5 : 1);
    const ts = new Date(baseTime.getTime() + offsetMinutes * 60_000);
    const service = services[i % services.length]!;
    const isCorrelated = Math.random() > 0.6 || window === 'outage' || window === 'degraded';

    let payload: OperationalPayload;

    if (isCorrelated) {
      // Correlated incident chain
      payload = {
        source: 'database_metrics',
        db: {
          service,
          metric: 'latency_p95',
          value: window === 'outage' ? 850 + Math.random() * 300 : 120 + Math.random() * 80,
          unit: 'ms',
          threshold: 200,
          tags: ['slow-query', window === 'outage' ? 'outage' : 'degraded']
        },
        ...(window !== 'normal' ? {
          zendesk: {
            ticketId: `ZD-${1000 + Math.floor(Math.random() * 900)}`,
            title: `Slow queries and timeouts on ${service}`,
            priority: (window === 'outage' ? 'urgent' : 'high') as 'urgent' | 'high',
            status: window === 'recovery' ? 'solved' : 'open',
            tags: ['performance', 'database'],
            ...(window === 'recovery' ? { resolutionTimeMs: 4500000 } : {}),
          },
          slack: {
            channel: '#ops-alerts',
            threadTs: `t${ts.getTime()}`,
            participantCount: 4 + Math.floor(Math.random() * 7),
            reactionScore: window === 'outage' ? 18 + Math.random() * 12 : 2 + Math.random() * 4,
            keywords: ['slow', 'postgres', 'redis', service],
            sentiment: window === 'outage' ? -0.8 : -0.4,
          },
        } : {}),
        severity: window === 'outage' ? 0.92 : window === 'degraded' ? 0.68 : 0.45,
        affectedServices: [service],
        temporalWindowMinutes: window === 'outage' ? 15 : 45
      };
    } else {
      // Normal background noise
      payload = {
        source: 'database_metrics',
        db: {
          service,
          metric: ['qps', 'cpu', 'disk_io'][Math.floor(Math.random()*3)] as any,
          value: 40 + Math.random() * 60,
          unit: ['req/s', '%', 'iops'][Math.floor(Math.random()*3)]!,
          tags: ['normal']
        },
        severity: 0.12,
        affectedServices: [service],
      };
    }

    const event: OperationalSignal = {
      eventId: `op-${window}-${i}-${uuidv4().slice(0,8)}`,
      timestamp: ts.toISOString(),
      type: 'environmental_observation',
      context: {
        sessionId: `sess-op-${window}`,
        traceId: `tr-${Date.now()}`
      },
      input: {
        text: `Operational signal from ${service}`,
        embedding: new Array(384).fill(0).map(() => Math.random()), // placeholder
        structured: payload as unknown as Readonly<Record<string, unknown>>
      },
      importanceScore: payload.severity,
      tags: ['operational', service, window],
      payload,
      graphSeeds: [service, ...(payload.zendesk ? [payload.zendesk.ticketId] : []), ...(payload.slack ? [payload.slack.threadTs] : [])],
    };

    signals.push(event);
  }

  return signals;
}

// Export helper for corpus runner
 export function generateAllOperationalData() {
  const base = new Date('2026-05-14T10:00:00Z');
  return [
    ...generateOperationalBatch('normal', 40, base),
    ...generateOperationalBatch('degraded', 60, new Date(base.getTime() + 2*3600*1000)),
    ...generateOperationalBatch('outage', 50, new Date(base.getTime() + 5*3600*1000)),
    ...generateOperationalBatch('recovery', 50, new Date(base.getTime() + 7*3600*1000)),
  ];
}
