'use client'

import type { ReactNode } from "react";
import Link from 'next/link';
import { usePathname } from 'next/navigation';


// Import client components
import NetworkStatsPanel from "./NetworkStatsPanel";
import SidebarNavigation from "./SidebarNavigation";
import HeaderActions from "./HeaderActions";
import FloatingProfileButton from "./FloatingProfileButton";
import { vznGoldTitleGradientClassName } from "@/app/lib/vznGoldTitleGradient";

// Routes that render edge-to-edge without the app chrome (sidebars / FAB).
const STANDALONE_ROUTE_PREFIXES = ['/landing', '/tree'];

const SharedLayout = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname();
  const isStandalone = STANDALONE_ROUTE_PREFIXES.some((prefix) =>
    pathname === prefix || pathname?.startsWith(`${prefix}/`)
  );

  if (isStandalone) {
    return <>{children}</>;
  }

  return (
    <>

    <div className="relative z-10 flex min-h-dvh lg:min-h-screen">
        <div className="max-w-7xl mx-auto w-full flex">
          {/* Left sidebar - starts below beta banner */}
          <aside className="hidden lg:block w-[275px] min-w-[275px] sticky top-0 self-start h-dvh">
            <div className="h-full px-4 pt-2 pb-4">
              <div className="sm:px-3 py-0 mt-2 mr-2">
                <Link href="/" className={`inline-block hover:opacity-80 transition-opacity`}>
                  <span
                    className={`text-3xl font-normal font-vzn-headings ${vznGoldTitleGradientClassName}`}
                  >
                    VZN.gold
                  </span>
                </Link>
              </div>
              <SidebarNavigation />
            </div>
          </aside>

          {/* Main content - with fixed width on desktop */}
          <main className="flex-1 lg:pt-0 lg:w-[600px] lg:min-w-[600px] lg:max-w-[600px] lg:ml-6 min-w-0">
            {/* No wrapper elements - let Feed component handle its own sticky header */}
            {children}
          </main>

          {/* Right sidebar - starts below beta banner */}
          <aside className="hidden xl:block w-[350px] min-w-[350px] sticky top-0 self-start h-dvh">
            <div className="h-full p-4">
              <div className="mb-6 flex justify-end">
                <HeaderActions />
              </div>
              <NetworkStatsPanel />
            </div>
          </aside>
        </div>
      </div>

      {/* Add Mobile Floating Action Button */}
      <div className="fixed bottom-6 right-6 z-[100] lg:hidden">
          <FloatingProfileButton />
      </div>
    </>
  );
};

export default SharedLayout;
