'use client';

import Link from 'next/link';
import { usePendingApprovals } from '../hooks/usePendingApprovals';

/** "Hyväksynnät" menu link with a badge for orders waiting on an approver. */
export function ApprovalsNavLink() {
  const pending = usePendingApprovals();
  const showBadge = pending !== null && pending > 0;
  return (
    <Link href="/approvals" className="inline-flex items-center gap-1.5">
      Hyväksynnät
      {showBadge && (
        <span className="rounded-full bg-lime px-2 py-0.5 font-sans text-[12px] leading-none text-lime-ink" aria-label={`${pending} odottaa`}>
          {pending}
        </span>
      )}
    </Link>
  );
}
