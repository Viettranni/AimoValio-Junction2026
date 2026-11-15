import type { Metadata } from 'next';
import { ApprovalsBoard } from './ApprovalsBoard';

export const metadata: Metadata = {
  title: 'Approvals · Valio Aimo',
  description: 'Sign off purchasing-agent orders that are outside their authority.',
};

export default function ApprovalsPage() {
  return <ApprovalsBoard />;
}
