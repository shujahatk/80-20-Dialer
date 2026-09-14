"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Always direct to login first when visiting root URL
    router.replace('/login');
  }, [router]);

  return (
    <div className="flex-1 flex items-center justify-center bg-slate-950 min-h-screen">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <p className="text-slate-400 text-sm animate-pulse">Redirecting to secure login...</p>
      </div>
    </div>
  );
}
