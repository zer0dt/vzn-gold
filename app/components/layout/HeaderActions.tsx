'use client'

import LoginButton from "./LoginButton"
import { ModeToggle } from "@/app/components/ui/mode-toggle"

export default function HeaderActions() {
  return (
    <div className="flex items-center gap-3">
      <LoginButton />
      <ModeToggle />
    </div>
  )
}