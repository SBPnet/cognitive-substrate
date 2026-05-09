export interface RawMetricMessage {
  readonly serviceId: string;
  readonly serviceType: string;
  readonly metricName: string;
  readonly value: number;
  readonly previousValue?: number;
  readonly baseline?: number;
  readonly labels?: Record<string, string>;
  readonly timestamp: string;
  readonly environment: string;
}

export interface RawLogMessage {
  readonly project: string;
  readonly serviceId: string;
  readonly serviceType: string;
  readonly unit?: string;
  readonly message: string;
  readonly offset?: string;
  readonly timestamp: string;
  readonly observedAt: string;
  readonly environment: string;
}

export interface RawMetadataMessage {
  readonly project: string;
  readonly serviceId?: string;
  readonly serviceType?: string;
  readonly source: "aiven.service" | "aiven.project_event" | "aiven.collector";
  readonly snapshot: unknown;
  readonly timestamp: string;
  readonly environment: string;
}
