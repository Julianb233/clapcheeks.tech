"use client"

import type React from "react"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Camera, Upload, Shield, AlertCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"

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
      setError("No se pudo acceder a la cámara. Por favor, sube una foto desde archivo.")
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
      setError("La foto de perfil es obligatoria")
      setIsLoading(false)
      return
    }

    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) throw new Error("No user found")

      // Upload photo to Vercel Blob (placeholder - you'll need to implement this)
      // For now, we'll use a placeholder URL
      const photoUrl = photoPreview // In production, upload to Vercel Blob

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

      router.push("/home")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al completar el perfil")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-teal-50 p-6">
      <div className="mx-auto max-w-2xl">
        <Card className="shadow-xl border-0">
          <CardHeader className="space-y-2 text-center">
            <div className="mx-auto w-16 h-16 bg-gradient-to-r from-pink-500 to-purple-600 rounded-full flex items-center justify-center mb-4">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-3xl font-bold bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent">
              Completa tu Perfil
            </CardTitle>
            <CardDescription className="text-base">
              Por seguridad, necesitamos verificar tu identidad antes de continuar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert className="mb-6 border-purple-200 bg-purple-50">
              <AlertCircle className="h-4 w-4 text-purple-600" />
              <AlertDescription className="text-purple-900">
                Todos los campos son obligatorios. Tu información está protegida y solo será visible para ti y en caso
                de emergencia.
              </AlertDescription>
            </Alert>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Photo Section */}
              <div className="space-y-4">
                <Label className="text-base font-semibold">Foto de Perfil *</Label>
                <div className="flex flex-col items-center gap-4">
                  {photoPreview ? (
                    <div className="relative">
                      <img
                        src={photoPreview || "/placeholder.svg"}
                        alt="Preview"
                        className="w-32 h-32 rounded-full object-cover border-4 border-purple-200"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2 bg-transparent"
                        onClick={() => {
                          setPhotoPreview(null)
                          setPhotoFile(null)
                        }}
                      >
                        Cambiar foto
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2 bg-transparent"
                        onClick={startCamera}
                        disabled={showCamera}
                      >
                        <Camera className="w-4 h-4" />
                        Tomar Foto
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2 bg-transparent"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="w-4 h-4" />
                        Subir Archivo
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                    </div>
                  )}

                  {showCamera && (
                    <div className="space-y-3">
                      <video
                        ref={videoRef}
                        autoPlay
                        className="w-full max-w-md rounded-lg border-2 border-purple-200"
                      />
                      <canvas ref={canvasRef} className="hidden" />
                      <div className="flex gap-2">
                        <Button type="button" onClick={capturePhoto} className="flex-1">
                          Capturar
                        </Button>
                        <Button type="button" variant="outline" onClick={stopCamera} className="flex-1 bg-transparent">
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Personal Information */}
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="phone">Teléfono *</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+56 9 1234 5678"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="address">Dirección *</Label>
                  <Textarea
                    id="address"
                    placeholder="Calle, número, comuna, ciudad"
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="dateOfBirth">Fecha de Nacimiento *</Label>
                  <Input
                    id="dateOfBirth"
                    type="date"
                    required
                    value={formData.dateOfBirth}
                    onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                  />
                </div>
              </div>

              {/* Emergency Contact */}
              <div className="space-y-4 pt-4 border-t">
                <h3 className="font-semibold text-lg">Contacto de Emergencia</h3>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="emergencyName">Nombre Completo *</Label>
                    <Input
                      id="emergencyName"
                      type="text"
                      placeholder="Nombre del contacto de emergencia"
                      required
                      value={formData.emergencyContactName}
                      onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="emergencyPhone">Teléfono *</Label>
                    <Input
                      id="emergencyPhone"
                      type="tel"
                      placeholder="+56 9 1234 5678"
                      required
                      value={formData.emergencyContactPhone}
                      onChange={(e) => setFormData({ ...formData, emergencyContactPhone: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                className="w-full h-12 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-lg"
                disabled={isLoading}
              >
                {isLoading ? "Guardando..." : "Completar Perfil"}
              </Button>

              <div className="text-center text-sm text-gray-600 pt-4">
                <p>
                  Para verificación de identidad adicional, recomendamos usar{" "}
                  <a
                    href="https://www.veriff.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-600 underline"
                  >
                    Veriff
                  </a>{" "}
                  o{" "}
                  <a
                    href="https://onfido.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-600 underline"
                  >
                    Onfido
                  </a>
                </p>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
