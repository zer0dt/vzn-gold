'use client'

import { Camera, Loader2, X } from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from "@/app/components/ui/avatar"
import { toast } from "@/app/hooks/use-toast"
import { useState } from 'react'
import { cn } from '@/app/lib/utils'
import { useWallet } from '@/app/hooks/use-wallet'

type ProfileImageFormProps = {
  type: 'avatar' | 'cover'
  currentUrl?: string | null
  action: (formData: FormData) => Promise<void>
  className?: string
}

export function ProfileImageForm({ type, currentUrl, action, className }: ProfileImageFormProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const isAvatar = type === 'avatar'
  const { fetchProfileAddresses } = useWallet()

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setPreviewUrl(URL.createObjectURL(file))
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedFile) return

    const formData = new FormData()
    formData.append('type', type)
    formData.append('file', selectedFile)

    try {
      setIsUploading(true)
      await action(formData)
      toast({
        title: "Success",
        description: `${type === 'avatar' ? 'Profile' : 'Cover'} image updated successfully`,
      })
      // Refresh profile data in wallet context to update sidebar avatar
      await fetchProfileAddresses()
      // Clean up
      setSelectedFile(null)
      setPreviewUrl(null)
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update image",
      })
    } finally {
      setIsUploading(false)
    }
  }

  const cancelPreview = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setSelectedFile(null)
    setPreviewUrl(null)
    
    // Reset the file input so the same file can be selected again
    const fileInput = document.getElementById(`${type}-input`) as HTMLInputElement
    if (fileInput) {
      fileInput.value = ''
    }
  }
  
  return (
    <div className={cn("relative", isAvatar ? 'inline-block' : 'w-full')}>
      <form onSubmit={handleSubmit}>
        <input 
          type="file"
          name="file" 
          id={`${type}-input`}
          className="hidden"
          accept="image/*"
          onChange={handleFileSelect}
        />
        
        {isAvatar ? (
          <div className="flex items-center gap-4">
            <div className="relative z-20">
              <label 
                htmlFor={`${type}-input`}
                className="relative group rounded-full cursor-pointer block"
              >
                {!selectedFile && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <Camera className="h-6 w-6 text-white" />
                  </div>
                )}
                <Avatar className={cn("relative ring-1 ring-border/60 bg-muted transition-[box-shadow,ring] group-hover:ring-amber-400/50", className)}>
                  {previewUrl || currentUrl ? (
                    <AvatarImage src={(previewUrl || currentUrl) ?? undefined} alt="Profile" />
                  ) : (
                    <>
                      <AvatarImage src="/default-avy.png" alt="Default Avatar" className="transition-opacity duration-200 dark:opacity-0" />
                      <AvatarImage src="/default-avy.png" alt="Default Avatar" className="absolute inset-0 transition-opacity duration-200 opacity-0 dark:opacity-100" />
                    </>
                  )}
                  <AvatarFallback className="bg-gray-200 dark:bg-gray-700 animate-pulse" />
                </Avatar>
              </label>
            </div>

            {selectedFile && (
              <div className="relative z-30 flex items-center gap-2 self-end mb-2 mt-2">
                <button
                  type="submit"
                  className="group relative inline-flex h-9 items-center justify-center overflow-hidden whitespace-nowrap rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-4 text-sm font-semibold text-black shadow-[0_8px_20px_-10px_rgba(245,158,11,0.55)] transition-all hover:scale-[1.01] hover:shadow-[0_12px_30px_-10px_rgba(245,158,11,0.75)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
                  disabled={isUploading}
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-amber-300 via-amber-200 to-amber-300 opacity-0 transition-opacity group-hover:opacity-100" />
                  <span className="relative flex items-center gap-2">
                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {isUploading ? 'Saving…' : 'Save'}
                  </span>
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full border border-border/70 bg-background/60 px-4 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
                  onClick={cancelPreview}
                  disabled={isUploading}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="absolute inset-0">
            <label 
              htmlFor={`${type}-input`}
              className="relative group w-full h-full cursor-pointer block"
            >
              {!selectedFile && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <Camera className="h-6 w-6 text-white" />
                </div>
              )}
            </label>

            {selectedFile && (
              <div className="absolute bottom-4 right-4 flex items-center gap-2 z-20">
                <button
                  type="submit"
                  className="group relative inline-flex h-9 items-center justify-center overflow-hidden whitespace-nowrap rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-4 text-sm font-semibold text-black shadow-[0_8px_20px_-10px_rgba(245,158,11,0.55)] transition-all hover:scale-[1.01] hover:shadow-[0_12px_30px_-10px_rgba(245,158,11,0.75)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
                  disabled={isUploading}
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-amber-300 via-amber-200 to-amber-300 opacity-0 transition-opacity group-hover:opacity-100" />
                  <span className="relative flex items-center gap-2">
                    {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {isUploading ? 'Saving…' : 'Save'}
                  </span>
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full border border-border/70 bg-background/90 px-4 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
                  onClick={cancelPreview}
                  disabled={isUploading}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  )
} 