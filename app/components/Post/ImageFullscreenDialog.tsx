import type React from 'react';
import Image from 'next/image';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from "@/app/components/ui/dialog";

type ImageFullscreenDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  imageUrl: string | null; // Pass the determined image URL
};

/**
 * A dialog component to display an image in fullscreen mode.
 */
export const ImageFullscreenDialog = ({ isOpen, onOpenChange, imageUrl }: ImageFullscreenDialogProps) => {

  if (!imageUrl) return null; // Don't render if no image URL

   const handleClose = () => onOpenChange(false);
   const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();


  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[100vw] max-h-[100vh] w-screen h-screen p-0 border-0 bg-black/90 flex items-center justify-center z-[110]"
        onClick={handleClose} // Close when clicking the background overlay
      >
        <DialogTitle className="sr-only">Post attachment</DialogTitle>
        {/* Close Button */}
        <button
          aria-label="Close fullscreen image view"
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none z-[111]" // Ensure button is above image
          onClick={handleClose}
        >
          <X className="h-8 w-8 text-white bg-black/30 rounded-full p-1" />
        </button>

        {/* Image Container */}
        <div
          className="relative w-full h-full flex items-center justify-center p-4" // Add padding around image container
          onClick={stopPropagation} // Prevent closing dialog when clicking image area
        >
           <Image
              key={imageUrl} // Re-render if URL changes somehow
              src={imageUrl}
              alt="Full screen post attachment"
              width={1920} // Max desired render width
              height={1080} // Max desired render height
              className="max-w-[95vw] max-h-[95vh] object-contain select-none" // Prevent text selection
              unoptimized // Consistent with PostImage
              priority // Ensure it loads promptly when opened
            />
        </div>
      </DialogContent>
    </Dialog>
  );
}; 