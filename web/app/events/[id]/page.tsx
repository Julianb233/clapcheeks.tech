import { redirect, notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Calendar, MapPin, Users, TrendingUp, Clock, Shield, AlertTriangle, ArrowLeft, Mountain } from "lucide-react"
import Link from "next/link"
import { format } from "date-fns"
import { JoinEventButton } from "@/components/join-event-button"
import { EventMap } from "@/components/event-map"

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { id } = await params

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login")
  }

  // Fetch event details
  const { data: event, error } = await supabase
    .from("events")
    .select(
      `
      *,
      creator:profiles!events_creator_id_fkey(id, full_name, display_name, is_verified, reputation_score, profile_image_url)
    `,
    )
    .eq("id", id)
    .single()

  if (error || !event) {
    notFound()
  }

  // Check if user is already participating
  const { data: participation } = await supabase
    .from("event_participants")
    .select("*")
    .eq("event_id", id)
    .eq("user_id", user.id)
    .single()

  const isParticipating = !!participation
  const isCreator = event.creator_id === user.id

  // Fetch participants
  const { data: participants } = await supabase
    .from("event_participants")
    .select(
      `
      *,
      user:profiles!event_participants_user_id_fkey(id, full_name, display_name, is_verified, reputation_score, profile_image_url)
    `,
    )
    .eq("event_id", id)

  const difficultyColors: Record<string, string> = {
    beginner: "bg-green-100 text-green-700 border-green-200",
    intermediate: "bg-yellow-100 text-yellow-700 border-yellow-200",
    advanced: "bg-red-100 text-red-700 border-red-200",
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-teal-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur border-b border-purple-100 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/events">
                <ArrowLeft className="w-5 h-5" />
                <span className="sr-only">Back</span>
              </Link>
            </Button>
            <h1 className="text-2xl font-bold text-gray-800">Event Details</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="space-y-6">
          {/* Event Header Card */}
          <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
            <CardHeader className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h2 className="text-3xl font-bold text-gray-800 mb-3">{event.title}</h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={difficultyColors[event.difficulty_level]}>
                      {event.difficulty_level}
                    </Badge>
                    <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                      {event.sport_type.replace("_", " ")}
                    </Badge>
                    {event.creator.is_verified && (
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                        <Shield className="w-3 h-3 mr-1" />
                        Verified Host
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-gray-700 leading-relaxed">{event.description}</p>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Event Details Grid */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-pink-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Date & Time</p>
                    <p className="font-semibold text-gray-800">
                      {format(new Date(event.event_date), "EEEE, MMMM d, yyyy")}
                    </p>
                    <p className="text-sm text-gray-600">{event.event_time}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Meeting Point</p>
                    <p className="font-semibold text-gray-800">{event.meeting_point}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
                    <Users className="w-5 h-5 text-teal-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Participants</p>
                    <p className="font-semibold text-gray-800">
                      {event.current_participants}/{event.max_participants || "Unlimited"}
                    </p>
                  </div>
                </div>

                {event.distance_km && (
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <TrendingUp className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Distance</p>
                      <p className="font-semibold text-gray-800">{event.distance_km} km</p>
                    </div>
                  </div>
                )}

                {event.estimated_duration_minutes && (
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
                      <Clock className="w-5 h-5 text-rose-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Duration</p>
                      <p className="font-semibold text-gray-800">
                        {Math.floor(event.estimated_duration_minutes / 60)}h {event.estimated_duration_minutes % 60}m
                      </p>
                    </div>
                  </div>
                )}

                {event.elevation_gain_m && (
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                      <Mountain className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Elevation Gain</p>
                      <p className="font-semibold text-gray-800">{event.elevation_gain_m}m</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-gray-100">
                <h3 className="font-semibold text-gray-800 mb-3">Location</h3>
                <EventMap
                  meetingPoint={event.meeting_point}
                  lat={event.meeting_point_lat}
                  lng={event.meeting_point_lng}
                />
              </div>

              {/* Route Description */}
              {event.route_description && (
                <div className="pt-4 border-t border-gray-100">
                  <h3 className="font-semibold text-gray-800 mb-2">Route Description</h3>
                  <p className="text-gray-600 leading-relaxed">{event.route_description}</p>
                </div>
              )}

              {/* Safety Information */}
              {(event.safety_notes || event.required_equipment) && (
                <div className="pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-5 h-5 text-orange-600" />
                    <h3 className="font-semibold text-gray-800">Safety Information</h3>
                  </div>
                  {event.safety_notes && <p className="text-gray-600 mb-2">{event.safety_notes}</p>}
                  {event.required_equipment && event.required_equipment.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-1">Required Equipment:</p>
                      <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                        {event.required_equipment.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-3">
                    <Link
                      href="/safety"
                      className="text-sm text-purple-600 hover:text-purple-700 underline inline-flex items-center gap-1"
                    >
                      <Shield className="w-4 h-4" />
                      View Safety Guidelines
                    </Link>
                  </div>
                </div>
              )}

              {/* Join Button */}
              {!isCreator && (
                <div className="pt-4">
                  <JoinEventButton eventId={event.id} isParticipating={isParticipating} />
                </div>
              )}

              {isCreator && (
                <div className="pt-4">
                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                    You are the organizer of this event
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Organizer Card */}
          <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
            <CardHeader>
              <CardTitle>Organized by</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 flex items-center justify-center text-white font-semibold text-lg">
                  {(event.creator.display_name || event.creator.full_name || "U")[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">
                      {event.creator.display_name || event.creator.full_name}
                    </p>
                    {event.creator.is_verified && <Shield className="w-4 h-4 text-blue-600" />}
                  </div>
                  <p className="text-sm text-gray-600">Reputation: {event.creator.reputation_score} points</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Participants Card */}
          {participants && participants.length > 0 && (
            <Card className="border-0 bg-white/80 backdrop-blur shadow-lg">
              <CardHeader>
                <CardTitle>Participants ({participants.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {participants.map((participant) => (
                    <div key={participant.id} className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-r from-teal-400 to-teal-600 flex items-center justify-center text-white font-semibold">
                        {(participant.user.display_name || participant.user.full_name || "U")[0].toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-800">
                            {participant.user.display_name || participant.user.full_name}
                          </p>
                          {participant.user.is_verified && <Shield className="w-3 h-3 text-blue-600" />}
                        </div>
                        <p className="text-xs text-gray-500">Reputation: {participant.user.reputation_score} points</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
