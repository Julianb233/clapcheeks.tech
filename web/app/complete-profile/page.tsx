"use client"

import type React from "react"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Camera, Upload, Shield, AlertCircle } from "lucide-react"

export default function CompleteProfilePage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState({
    phone: "",
    address: "",
    dateOfBirth: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
  })

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setShowCamera(true)
      }
    } catch (err) {
      setError("Could not access camera. Please upload a photo from file.")
    }
  }

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current
      const canvas = canvasRef.current
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.drawImage(video, 0, 0)
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], "profile-photo.jpg", { type: "image/jpeg" })
            setPhotoFile(file)
            setPhotoPreview(canvas.toDataURL())
            stopCamera()
          }
        }, "image/jpeg")
      }
    }
  }

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      stream.getTracks().forEach((track) => track.stop())
      setShowCamera(false)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPhotoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    if (!photoFile) {
      setError("Profile photo is required")
      setIsLoading(false)
      return
    }

    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) throw new Error("No user found")

      // Upload photo to Supabase Storage (private `knowledge` bucket)
      const ext = photoFile.name.split(".").pop()?.toLowerCase() || "jpg"
      const fileName = `${user.id}/avatar.${ext}`
      const { error: uploadError } = await supabase.storage
        .from("knowledge")
        .upload(fileName, photoFile, {
          upsert: true,
          contentType: photoFile.type || "image/jpeg",
        })
      if (uploadError) throw uploadError

      // Bucket is private — use a long-lived signed URL (1 year)
      const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
      const { data: signed, error: signedErr } = await supabase.storage
        .from("knowledge")
        .createSignedUrl(fileName, ONE_YEAR_SECONDS)
      if (signedErr || !signed?.signedUrl) {
        throw signedErr || new Error("Could not generate signed URL for profile photo")
      }
      const photoUrl = signed.signedUrl

      // Update profile
      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          phone: formData.phone,
          address: formData.address,
          date_of_birth: formData.dateOfBirth,
          emergency_contact_name: formData.emergencyContactName,
          emergency_contact_phone: formData.emergencyContactPhone,
          profile_image_url: photoUrl,
          profile_completed: true,
        })
        .eq("id", user.id)

      if (updateError) throw updateError

      router.push("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error completing profile")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black px-6 py-10">
      {/* Background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="orb floating w-[500px] h-[500px] bg-brand-700"
          style={{ top: '-10%', right: '-10%' }}
        />
        <div
          className="orb floating-slow w-72 h-72 bg-pink-700"
          style={{ bottom: '10%', left: '-5%' }}
        />
      </div>

      <div className="relative mx-auto max-w-2xl">
        <div className="bg-white/[0.03] border border-white/[0.12] rounded-2xl glow-border shadow-2xl shadow-brand-900/20 overflow-hidden">
          <div className="p-8 pb-0 text-center">
            <div className="mx-auto w-16 h-16 bg-gradient-to-r from-brand-500 to-brand-700 rounded-full flex items-center justify-center mb-6">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              Complete Your Profile
            </h1>
            <p className="text-white/40 text-sm">
              For security, we need to verify your identity before continuing
            </p>
          </div>
          <div className="p-8">
            <div className="bg-brand-900/20 border border-brand-700/30 rounded-xl px-4 py-3 mb-6 flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-brand-400 mt-0.5 shrink-0" />
              <p className="text-brand-300/80 text-sm">
                All fields are required. Your information is protected and only visible to you and in case of emergency.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Photo Section */}
              <div className="space-y-4">
                <label className="text-sm font-semibold text-white">Profile Photo *</label>
                <div className="flex flex-col items-center gap-4">
                  {photoPreview ? (
                    <div className="relative text-center">
                      <img
                        src={photoPreview || "/placeholder.svg"}
                        alt="Profile preview"
                        className="w-32 h-32 rounded-full object-cover border-2 border-brand-500/40"
                      />
                      <button
                        type="button"
                        className="mt-3 text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
                        onClick={() => {
                          setPhotoPreview(null)
                          setPhotoFile(null)
                        }}
                      >
                        Change photo
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="flex items-center gap-2 text-white/60 hover:text-white text-sm bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2.5 rounded-xl transition-all"
                        onClick={startCamera}
                        disabled={showCamera}
                      >
                        <Camera className="w-4 h-4" />
                        Take Photo
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-2 text-white/60 hover:text-white text-sm bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2.5 rounded-xl transition-all"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="w-4 h-4" />
                        Upload File
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileUpload}
                        aria-label="Upload profile photo"
                      />
                    </div>
                  )}

                  {showCamera && (
                    <div className="space-y-3 w-full max-w-md">
                      <video
                        ref={videoRef}
                        autoPlay
                        className="w-full rounded-lg border border-white/10"
                      />
                      <canvas ref={canvasRef} className="hidden" />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={capturePhoto}
                          className="flex-1 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
                        >
                          Capture
                        </button>
                        <button
                          type="button"
                          onClick={stopCamera}
                          className="flex-1 text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 text-sm py-2.5 rounded-xl transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Personal Information */}
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <label htmlFor="phone" className="text-sm text-white/60">Phone *</label>
                  <input
                    id="phone"
                    type="tel"
                    placeholder="+1 555 123 4567"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm transition-colors outline-none focus:ring-1 focus:ring-brand-500/50"
                  />
                </div>

                <div className="grid gap-2">
                  <label htmlFor="address" className="text-sm text-white/60">Address *</label>
                  <textarea
                    id="address"
                    placeholder="Street, city, state, zip"
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    rows={3}
                    className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm transition-colors outline-none focus:ring-1 focus:ring-brand-500/50 resize-none"
                  />
                </div>

                <div className="grid gap-2">
                  <label htmlFor="dateOfBirth" className="text-sm text-white/60">Date of Birth *</label>
                  <input
                    id="dateOfBirth"
                    type="date"
                    required
                    value={formData.dateOfBirth}
                    onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white text-sm transition-colors outline-none focus:ring-1 focus:ring-brand-500/50"
                  />
                </div>
              </div>

              {/* Emergency Contact */}
              <div className="space-y-4 pt-4 border-t border-white/8">
                <h3 className="font-semibold text-white">Emergency Contact</h3>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <label htmlFor="emergencyName" className="text-sm text-white/60">Full Name *</label>
                    <input
                      id="emergencyName"
                      type="text"
                      placeholder="Emergency contact name"
                      required
                      value={formData.emergencyContactName}
                      onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm transition-colors outline-none focus:ring-1 focus:ring-brand-500/50"
                    />
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="emergencyPhone" className="text-sm text-white/60">Phone *</label>
                    <input
                      id="emergencyPhone"
                      type="tel"
                      placeholder="+1 555 123 4567"
                      required
                      value={formData.emergencyContactPhone}
                      onChange={(e) => setFormData({ ...formData, emergencyContactPhone: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 hover:border-white/20 focus:border-brand-500 rounded-xl px-4 py-3 text-white placeholder-white/20 text-sm transition-colors outline-none focus:ring-1 focus:ring-brand-500/50"
                    />
                  </div>
                </div>
              </div>

              {error && (
                <div className="bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-900/40"
                disabled={isLoading}
              >
                {isLoading ? "Saving..." : "Complete Profile"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
