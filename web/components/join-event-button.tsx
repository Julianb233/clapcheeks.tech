"use client"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { UserPlus, UserMinus } from "lucide-react"

export function JoinEventButton({ eventId, isParticipating }: { eventId: string; isParticipating: boolean }) {
  const [loading, setLoading] = useState(false)
  const [participating, setParticipating] = useState(isParticipating)
  const router = useRouter()

  const handleJoinEvent = async () => {
    setLoading(true)
    const supabase = createClient()

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      if (participating) {
        // Leave event
        const { error } = await supabase
          .from("event_participants")
          .delete()
          .eq("event_id", eventId)
          .eq("user_id", user.id)

        if (error) throw error

        // Update event participant count
        const { data: event } = await supabase.from("events").select("current_participants").eq("id", eventId).single()

        if (event) {
          await supabase
            .from("events")
            .update({ current_participants: Math.max(0, event.current_participants - 1) })
            .eq("id", eventId)
        }

        setParticipating(false)
      } else {
        // Join event
        const { error } = await supabase.from("event_participants").insert({
          event_id: eventId,
          user_id: user.id,
          status: "confirmed",
        })

        if (error) throw error

        // Update event participant count
        const { data: event } = await supabase.from("events").select("current_participants").eq("id", eventId).single()

        if (event) {
          await supabase
            .from("events")
            .update({ current_participants: event.current_participants + 1 })
            .eq("id", eventId)
        }

        setParticipating(true)
      }

      router.refresh()
    } catch (error) {
      console.error("[v0] Error joining/leaving event:", error)
      alert("Failed to update participation status. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      onClick={handleJoinEvent}
      disabled={loading}
      className={
        participating
          ? "w-full h-12 bg-gray-200 hover:bg-gray-300 text-gray-700"
          : "w-full h-12 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700"
      }
    >
      {loading ? (
        "Processing..."
      ) : participating ? (
        <>
          <UserMinus className="w-4 h-4 mr-2" />
          Leave Event
        </>
      ) : (
        <>
          <UserPlus className="w-4 h-4 mr-2" />
          Join Event
        </>
      )}
    </Button>
  )
}
