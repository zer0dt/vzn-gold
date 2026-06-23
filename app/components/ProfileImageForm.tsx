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
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-amber-300/60 bg-amber-500 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-black shadow-[0_2px_10px_rgba(0,0,0,0.35)] transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:pointer-events-none disabled:opacity-50"
                  disabled={isUploading}
                >
                  {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isUploading ? 'Saving' : 'Save'}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-white/20 bg-black/75 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-white shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50 disabled:pointer-events-none disabled:opacity-50"
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
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-amber-300/60 bg-amber-500 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-black shadow-[0_2px_10px_rgba(0,0,0,0.35)] transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:pointer-events-none disabled:opacity-50"
                  disabled={isUploading}
                >
                  {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isUploading ? 'Saving' : 'Save'}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-white/20 bg-black/75 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-white shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/50 disabled:pointer-events-none disabled:opacity-50"
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