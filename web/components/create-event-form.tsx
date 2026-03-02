"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useState } from "react"

export function CreateEventForm({ userId }: { userId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    sport_type: "",
    difficulty_level: "",
    meeting_point: "",
    event_date: "",
    event_time: "",
    max_participants: "",
    distance_km: "",
    elevation_gain_m: "",
    estimated_duration_minutes: "",
    route_description: "",
    safety_notes: "",
    required_equipment: "",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()

    try {
      const { data, error } = await supabase
        .from("events")
        .insert({
          creator_id: userId,
          title: formData.title,
          description: formData.description,
          sport_type: formData.sport_type,
          difficulty_level: formData.difficulty_level,
          meeting_point: formData.meeting_point,
          event_date: formData.event_date,
          event_time: formData.event_time,
          max_participants: formData.max_participants ? Number.parseInt(formData.max_participants) : null,
          distance_km: formData.distance_km ? Number.parseFloat(formData.distance_km) : null,
          elevation_gain_m: formData.elevation_gain_m ? Number.parseInt(formData.elevation_gain_m) : null,
          estimated_duration_minutes: formData.estimated_duration_minutes
            ? Number.parseInt(formData.estimated_duration_minutes)
            : null,
          route_description: formData.route_description || null,
          safety_notes: formData.safety_notes || null,
          required_equipment: formData.required_equipment
            ? formData.required_equipment.split(",").map((item) => item.trim())
            : null,
          status: "open",
        })
        .select()
        .single()

      if (error) throw error

      // Add creator as first participant
      await supabase.from("event_participants").insert({
        event_id: data.id,
        user_id: userId,
        status: "confirmed",
      })

      // Update user's event count
      const { data: profile } = await supabase.from("profiles").select("total_events_created").eq("id", userId).single()

      if (profile) {
        await supabase
          .from("profiles")
          .update({
            total_events_created: (profile.total_events_created || 0) + 1,
            reputation_score: (profile.total_events_created || 0) + 1 * 10, // 10 points per event created
          })
          .eq("id", userId)
      }

      router.push(`/events/${data.id}`)
    } catch (error) {
      console.error("[v0] Error creating event:", error)
      alert("Failed to create event. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
      <CardHeader>
        <CardTitle>Event Details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Event Title *</Label>
              <Input
                id="title"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Morning Trail Run at Cerro San Cristóbal"
              />
            </div>

            <div>
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                required
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe your event..."
                rows={4}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
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
                <Label htmlFor="difficulty_level">Difficulty Level *</Label>
                <Select
                  value={formData.difficulty_level}
                  onValueChange={(value) => setFormData({ ...formData, difficulty_level: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select difficulty" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Location & Time */}
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <h3 className="font-semibold text-gray-800">Location & Time</h3>

            <div>
              <Label htmlFor="meeting_point">Meeting Point *</Label>
              <Input
                id="meeting_point"
                required
                value={formData.meeting_point}
                onChange={(e) => setFormData({ ...formData, meeting_point: e.target.value })}
                placeholder="Plaza de Armas, Santiago"
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="event_date">Date *</Label>
                <Input
                  id="event_date"
                  type="date"
                  required
                  value={formData.event_date}
                  onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                />
              </div>

              <div>
                <Label htmlFor="event_time">Time *</Label>
                <Input
                  id="event_time"
                  type="time"
                  required
                  value={formData.event_time}
                  onChange={(e) => setFormData({ ...formData, event_time: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Event Details */}
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <h3 className="font-semibold text-gray-800">Event Details</h3>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="max_participants">Max Participants</Label>
                <Input
                  id="max_participants"
                  type="number"
                  value={formData.max_participants}
                  onChange={(e) => setFormData({ ...formData, max_participants: e.target.value })}
                  placeholder="Leave empty for unlimited"
                />
              </div>

              <div>
                <Label htmlFor="distance_km">Distance (km)</Label>
                <Input
                  id="distance_km"
                  type="number"
                  step="0.1"
                  value={formData.distance_km}
                  onChange={(e) => setFormData({ ...formData, distance_km: e.target.value })}
                  placeholder="10.5"
                />
              </div>

              <div>
                <Label htmlFor="elevation_gain_m">Elevation Gain (m)</Label>
                <Input
                  id="elevation_gain_m"
                  type="number"
                  value={formData.elevation_gain_m}
                  onChange={(e) => setFormData({ ...formData, elevation_gain_m: e.target.value })}
                  placeholder="250"
                />
              </div>

              <div>
                <Label htmlFor="estimated_duration_minutes">Duration (minutes)</Label>
                <Input
                  id="estimated_duration_minutes"
                  type="number"
                  value={formData.estimated_duration_minutes}
                  onChange={(e) => setFormData({ ...formData, estimated_duration_minutes: e.target.value })}
                  placeholder="120"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="route_description">Route Description</Label>
              <Textarea
                id="route_description"
                value={formData.route_description}
                onChange={(e) => setFormData({ ...formData, route_description: e.target.value })}
                placeholder="Describe the route, terrain, and any notable landmarks..."
                rows={3}
              />
            </div>
          </div>

          {/* Safety Information */}
          <div className="space-y-4 pt-4 border-t border-gray-100">
            <h3 className="font-semibold text-gray-800">Safety Information</h3>

            <div>
              <Label htmlFor="safety_notes">Safety Notes</Label>
              <Textarea
                id="safety_notes"
                value={formData.safety_notes}
                onChange={(e) => setFormData({ ...formData, safety_notes: e.target.value })}
                placeholder="Any safety considerations participants should know..."
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="required_equipment">Required Equipment (comma-separated)</Label>
              <Input
                id="required_equipment"
                value={formData.required_equipment}
                onChange={(e) => setFormData({ ...formData, required_equipment: e.target.value })}
                placeholder="Helmet, Water bottle, Sunscreen"
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-12 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700"
          >
            {loading ? "Creating Event..." : "Create Event"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
