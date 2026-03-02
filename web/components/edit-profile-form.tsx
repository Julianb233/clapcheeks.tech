"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"

type Profile = {
  full_name: string | null
  display_name: string | null
  bio: string | null
  phone: string | null
  city: string | null
  country: string | null
  preferred_sports: string[] | null
}

const sportOptions = [
  { id: "cycling", label: "Cycling" },
  { id: "mtb", label: "Mountain Bike" },
  { id: "trail_running", label: "Trail Running" },
  { id: "trekking", label: "Trekking" },
  { id: "running", label: "Running" },
]

export function EditProfileForm({ profile, userId }: { profile: Profile | null; userId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    full_name: profile?.full_name || "",
    display_name: profile?.display_name || "",
    bio: profile?.bio || "",
    phone: profile?.phone || "",
    city: profile?.city || "",
    country: profile?.country || "Chile",
    preferred_sports: profile?.preferred_sports || [],
  })

  const handleSportToggle = (sportId: string) => {
    setFormData((prev) => ({
      ...prev,
      preferred_sports: prev.preferred_sports.includes(sportId)
        ? prev.preferred_sports.filter((s) => s !== sportId)
        : [...prev.preferred_sports, sportId],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()

    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: formData.full_name || null,
          display_name: formData.display_name || null,
          bio: formData.bio || null,
          phone: formData.phone || null,
          city: formData.city || null,
          country: formData.country || null,
          preferred_sports: formData.preferred_sports.length > 0 ? formData.preferred_sports : null,
        })
        .eq("id", userId)

      if (error) throw error

      router.push("/profile")
    } catch (error) {
      console.error("[v0] Error updating profile:", error)
      alert("Failed to update profile. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
      <CardHeader>
        <CardTitle>Profile Information</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="full_name">Full Name</Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                placeholder="Maria Silva"
              />
            </div>

            <div>
              <Label htmlFor="display_name">Display Name</Label>
              <Input
                id="display_name"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                placeholder="Maria S."
              />
            </div>
          </div>

          <div>
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              placeholder="Tell us about yourself and your sports interests..."
              rows={4}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+56 9 1234 5678"
              />
            </div>

            <div>
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="Santiago"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="country">Country</Label>
            <Input
              id="country"
              value={formData.country}
              onChange={(e) => setFormData({ ...formData, country: e.target.value })}
              placeholder="Chile"
            />
          </div>

          <div className="space-y-3">
            <Label>Preferred Sports</Label>
            <div className="space-y-2">
              {sportOptions.map((sport) => (
                <div key={sport.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={sport.id}
                    checked={formData.preferred_sports.includes(sport.id)}
                    onCheckedChange={() => handleSportToggle(sport.id)}
                  />
                  <Label htmlFor={sport.id} className="text-sm font-normal cursor-pointer">
                    {sport.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full h-12 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700"
          >
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
