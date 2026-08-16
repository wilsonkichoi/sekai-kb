import type { PlaceConfig } from '../../place.config';

export interface AnalyticsProviders {
  ga4: { enabled: boolean; measurementId: string };
  cloudflare: { enabled: boolean; token: string };
}

export function resolveAnalytics(config: PlaceConfig): AnalyticsProviders {
  const analyticsOn = config.features?.analytics === true;
  const ga4Id = (config.analytics?.ga4MeasurementId ?? '').trim();
  const cfToken = (config.analytics?.cloudflareWebAnalyticsToken ?? '').trim();
  return {
    ga4: { enabled: analyticsOn && ga4Id !== '', measurementId: ga4Id },
    cloudflare: { enabled: analyticsOn && cfToken !== '', token: cfToken },
  };
}
