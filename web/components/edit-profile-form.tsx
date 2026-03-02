"use client"

import type React from "react"

import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useState } from "react"

type Profile = {
  full_name: string | null
  display_name: string | null
  bio: string | null
  phone: string | null
  city: string | null
  country: string | null
}

export function EditProfileForm({ profile, userId }: { profile: Profile | null; userId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    full_name: profile?.full_name || "",
    display_name: profile?.display_name || "",
    bio: profile?.bio || "",
    phone: profile?.phone || "",
    city: profile?.city || "",
    country: profile?.country || "",
  })

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
        })
        .eq("id", userId)

      if (error) throw error

      router.push("/profile")
    } catch (error) {
      console.error("Error updating profile:", error)
      alert("Failed to update profile. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-white mb-6">Profile Information</h2>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="full_name" className="block text-sm text-white/60 mb-1.5">Full Name</label>
            <input
              id="full_name"
              type="text"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              placeholder="Your name"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-brand-500/50"
            />
          </div>

          <div>
            <label htmlFor="display_name" className="block text-sm text-white/60 mb-1.5">Display Name</label>
            <input
              id="display_name"
              type="text"
              value={formData.display_name}
              onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              placeholder="How others see you"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-brand-500/50"
            />
          </div>
        </div>

        <div>
          <label htmlFor="bio" className="block text-sm text-white/60 mb-1.5">Bio</label>
          <textarea
            id="bio"
            value={formData.bio}
            onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
            placeholder="Tell us about yourself..."
            rows={4}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-brand-500/50 resize-none"
          />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="phone" className="block text-sm text-white/60 mb-1.5">Phone</label>
            <input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+1 555 123 4567"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-brand-500/50"
            />
          </div>

          <div>
            <label htmlFor="city" className="block text-sm text-white/60 mb-1.5">City</label>
            <input
              id="city"
              type="text"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              placeholder="Your city"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-brand-500/50"
            />
          </div>
        </div>

        <div>
          <label htmlFor="country" className="block text-sm text-white/60 mb-1.5">Country</label>
          <input
            id="country"
            type="text"
            value={formData.country}
            onChange={(e) => setFormData({ ...formData, country: e.target.value })}
            placeholder="Your country"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-brand-500/50"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-3 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  )
}
