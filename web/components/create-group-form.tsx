"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useState } from "react"

export function CreateGroupForm({ userId }: { userId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    sport_type: "",
    is_private: false,
    max_members: "",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()

    try {
      const { data, error } = await supabase
        .from("groups")
        .insert({
          leader_id: userId,
          name: formData.name,
          description: formData.description,
          sport_type: formData.sport_type,
          is_private: formData.is_private,
          max_members: formData.max_members ? Number.parseInt(formData.max_members) : null,
        })
        .select()
        .single()

      if (error) throw error

      // Add leader as first member
      await supabase.from("group_members").insert({
        group_id: data.id,
        user_id: userId,
        role: "leader",
      })

      router.push(`/groups/${data.id}`)
    } catch (error) {
      console.error("[v0] Error creating group:", error)
      alert("Failed to create group. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
      <CardHeader>
        <CardTitle>Group Details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <Label htmlFor="name">Group Name *</Label>
            <Input
              id="name"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Santiago Women Cyclists"
            />
          </div>

          <div>
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              required
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe your group and what makes it special..."
              rows={4}
            />
          </div>

          <div>
            <Label htmlFor="sport_type">Sport Type *</Label>
            <Select
              value={formData.sport_type}
              onValueChange={(value) => setFormData({ ...formData, sport_type: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select sport" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cycling">Cycling</SelectItem>
                <SelectItem value="mtb">Mountain Bike</SelectItem>
                <SelectItem value="trail_running">Trail Running</SelectItem>
                <SelectItem value="trekking">Trekking</SelectItem>
                <SelectItem value="running">Running</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="max_members">Max Members</Label>
            <Input
              id="max_members"
              type="number"
              value={formData.max_members}
              onChange={(e) => setFormData({ ...formData, max_members: e.target.value })}
              placeholder="Leave empty for unlimited"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="is_private"
              checked={formData.is_private}
              onCheckedChange={(checked) => setFormData({ ...formData, is_private: checked as boolean })}
            />
            <Label htmlFor="is_private" className="text-sm font-normal cursor-pointer">
              Make this a private group (members need approval to join)
            </Label>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-12 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700"
          >
            {loading ? "Creating Group..." : "Create Group"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
