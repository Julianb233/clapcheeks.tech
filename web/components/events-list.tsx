"use client"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Calendar, MapPin, Users, TrendingUp, Shield } from "lucide-react"
import Link from "next/link"
import { format } from "date-fns"

type Event = {
  id: string
  title: string
  description: string
  sport_type: string
  difficulty_level: string
  meeting_point: string
  event_date: string
  event_time: string
  max_participants: number
  current_participants: number
  distance_km: number
  creator: {
    full_name: string
    display_name: string
    is_verified: boolean
    reputation_score: number
  }
}

const difficultyColors: Record<string, string> = {
  beginner: "bg-green-100 text-green-700 border-green-200",
  intermediate: "bg-yellow-100 text-yellow-700 border-yellow-200",
  advanced: "bg-red-100 text-red-700 border-red-200",
}

const sportColors: Record<string, string> = {
  cycling: "from-pink-400 to-pink-600",
  mtb: "from-purple-400 to-purple-600",
  trail_running: "from-teal-400 to-teal-600",
  trekking: "from-orange-400 to-orange-600",
  running: "from-rose-400 to-rose-600",
}

export function EventsList({ events }: { events: Event[] }) {
  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-lg text-gray-600">No events found. Be the first to create one!</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {events.map((event) => (
        <Link key={event.id} href={`/events/${event.id}`}>
          <Card className="hover:shadow-lg transition-all hover:scale-[1.02] cursor-pointer border-0 bg-white/80 backdrop-blur h-full">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-lg text-gray-800 line-clamp-2">{event.title}</h3>
                <div
                  className={`w-10 h-10 rounded-full bg-gradient-to-r ${sportColors[event.sport_type]} flex-shrink-0`}
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={difficultyColors[event.difficulty_level]}>
                  {event.difficulty_level}
                </Badge>
                {event.creator.is_verified && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    <Shield className="w-3 h-3 mr-1" />
                    Verified
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-600 line-clamp-2">{event.description}</p>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <Calendar className="w-4 h-4 flex-shrink-0" />
                  <span>
                    {format(new Date(event.event_date), "MMM d, yyyy")} at {event.event_time}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <MapPin className="w-4 h-4 flex-shrink-0" />
                  <span className="line-clamp-1">{event.meeting_point}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <Users className="w-4 h-4 flex-shrink-0" />
                  <span>
                    {event.current_participants}/{event.max_participants || "∞"} participants
                  </span>
                </div>
                {event.distance_km && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <TrendingUp className="w-4 h-4 flex-shrink-0" />
                    <span>{event.distance_km} km</span>
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs text-gray-500">
                  Organized by {event.creator.display_name || event.creator.full_name}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}
