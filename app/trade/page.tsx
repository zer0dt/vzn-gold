import { ArrowLeft } from "lucide-react";
import BackButton from "@/app/components/BackButton";
import TradePageClient from "./TradePageClient";

export default function ProfileTokenMarketplace() {
  return (
    <div className="w-full max-w-2xl lg:mt-8 mt-8 mx-auto px-4 pb-24 lg:pb-8">
      {/* Header with Back Button */}
      <div className="flex items-center gap-3 mb-6">
        <BackButton>
          <ArrowLeft className="h-5 w-5" />
        </BackButton>
        <div className="flex-1 flex justify-between items-center">
          <h1 className="font-vzn-headings text-2xl font-normal tracking-tight">Trade</h1>
        </div>
      </div>

      <TradePageClient />
    </div>
  );
}
