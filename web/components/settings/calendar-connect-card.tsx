'use client'

import * as React from 'react'
import { Calendar as CalendarIcon, Check, ExternalLink, Loader2, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ConnectionStatus {
  connected: boolean
  email?: string
  calendarId?: string
  scopes?: string[]
  connectedAt?: string
}

export function CalendarConnectCard({ nextPath = '/settings' }: { nextPath?: string }) {
  const [status, setStatus] = React.useState<ConnectionStatus | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [disconnecting, setDisconnecting] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/calendar/events', { method: 'GET' })
      if (res.ok) {
        const data = (await res.json()) as ConnectionStatus
        setStatus(data)
      } else {
        setStatus({ connected: false })
      }
    } catch {
      setStatus({ connected: false })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleConnect = () => {
    window.location.href = `/api/auth/google/connect?next=${encodeURIComponent(nextPath)}`
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await fetch('/api/auth/google/disconnect', { method: 'POST' })
      await load()
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <>
    <Card className="p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-primary/10 text-primary p-2">
          <CalendarIcon className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-1">
          <h3 className="font-medium">Google Calendar</h3>
          <p className="text-sm text-muted-foreground">
            Let your AI co-pilot book dates directly on your calendar with Google Meet links and
            invites sent to matches.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Checking connection…</span>
        </div>
      ) : status?.connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-500 text-sm">
            <Check className="h-4 w-4" />
            <span>
              Connected as <strong>{status.email}</strong>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://calendar.google.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1"
              >
                Open Calendar
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={disconnecting}
              className="text-destructive hover:text-destructive"
            >
              {disconnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Unplug className="h-3.5 w-3.5 mr-1.5" />
              )}
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={handleConnect}>
          <CalendarIcon className="h-4 w-4 mr-2" />
          Connect Google Calendar
        </Button>
      )}
    </Card>

      {/* PWA-safe replacement for confirm() */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Google Calendar?</AlertDialogTitle>
            <AlertDialogDescription>
              Your AI co-pilot will no longer schedule dates automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
