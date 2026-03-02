"use client"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { UserPlus, UserMinus } from "lucide-react"

export function JoinGroupButton({ groupId, isMember }: { groupId: string; isMember: boolean }) {
  const [loading, setLoading] = useState(false)
  const [member, setMember] = useState(isMember)
  const router = useRouter()

  const handleJoinGroup = async () => {
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

      if (member) {
        // Leave group
        const { error } = await supabase.from("group_members").delete().eq("group_id", groupId).eq("user_id", user.id)

        if (error) throw error

        // Update group member count
        const { data: group } = await supabase.from("groups").select("current_members").eq("id", groupId).single()

        if (group) {
          await supabase
            .from("groups")
            .update({ current_members: Math.max(0, group.current_members - 1) })
            .eq("id", groupId)
        }

        setMember(false)
      } else {
        // Join group
        const { error } = await supabase.from("group_members").insert({
          group_id: groupId,
          user_id: user.id,
          role: "member",
        })

        if (error) throw error

        // Update group member count
        const { data: group } = await supabase.from("groups").select("current_members").eq("id", groupId).single()

        if (group) {
          await supabase
            .from("groups")
            .update({ current_members: group.current_members + 1 })
            .eq("id", groupId)
        }

        setMember(true)
      }

      router.refresh()
    } catch (error) {
      console.error("[v0] Error joining/leaving group:", error)
      alert("Failed to update membership status. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      onClick={handleJoinGroup}
      disabled={loading}
      className={
        member
          ? "w-full h-12 bg-gray-200 hover:bg-gray-300 text-gray-700"
          : "w-full h-12 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700"
      }
    >
      {loading ? (
        "Processing..."
      ) : member ? (
        <>
          <UserMinus className="w-4 h-4 mr-2" />
          Leave Group
        </>
      ) : (
        <>
          <UserPlus className="w-4 h-4 mr-2" />
          Join Group
        </>
      )}
    </Button>
  )
}
