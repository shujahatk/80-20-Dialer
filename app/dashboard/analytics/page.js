"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AnalyticsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return (
    <div className="flex h-screen bg-[#07090e] items-center justify-center text-slate-400 text-xs">
      Redirecting to Dashboard...
    </div>
  );
}
