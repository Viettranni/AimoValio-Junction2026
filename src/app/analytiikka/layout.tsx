import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AnalyticsShell } from '@/shared/components/AnalyticsShell';

export const metadata: Metadata = {
  title: 'Analytiikka · Aimo',
  description: 'Vuotesi ruoan parissa, vastauksia omaan tilausdataasi ja ravintoloidesi yhteenveto.',
};

export default function AnalytiikkaLayout({ children }: { children: ReactNode }) {
  return <AnalyticsShell>{children}</AnalyticsShell>;
}
