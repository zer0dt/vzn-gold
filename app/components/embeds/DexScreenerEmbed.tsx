import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const DexScreenerEmbed = ({ url }: { url: string }) => {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  // Only render on client side to avoid hydration mismatches
  useEffect(() => {
    setMounted(true);
  }, []);
  
  const cleanUrl = url.replace(/\[([^\]]*)\]\((.*?)\)/g, '$2')
                      .replace(/\]\(https?:.*$/g, '');
  
  const match = cleanUrl.match(/dexscreener\.com\/([^/\s]+)\/([^/\s?&]+)/);
  const chain = match?.[1];
  const pairAddress = match?.[2];
  
  if (!chain || !pairAddress) {
    return null;
  }
  
  const chartTheme = theme === "dark" ? "dark" : "light";
  
  return (
    <div className="-my-2 p-0 bg-muted/20 rounded-lg pb-2">
      <div className="relative w-full" style={{paddingBottom: '110%'}}>
        <style jsx>{`
          @media(min-width:700px) {
            div {
              padding-bottom: 70%!important;
            }
          }
        `}</style>
        
        {/* Only render iframe on client side */}
        {mounted ? (
          <iframe 
            key={`dexscreener-${mounted}-${chain}-${pairAddress}-${theme}`}
            src={`https://dexscreener.com/${chain}/${pairAddress}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartDefaultOnMobile=1&chartTheme=${chartTheme}&theme=${chartTheme}&chartStyle=1&chartType=usd&interval=5`}
            style={{position: 'absolute', width: '100%', height: '100%', top: 0, left: 0, border: 0}}
            className="rounded-md"
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
            <span className="text-muted-foreground text-sm">Loading chart...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default DexScreenerEmbed; 