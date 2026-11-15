import { AppShell } from '@/shared/components/AppShell';

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return <AppShell>{children}</AppShell>;
}
