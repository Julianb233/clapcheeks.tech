"use client"

import { Card, CardContent } from "@/components/ui/card"
import { useRouter } from "next/navigation"
import { Bike, Mountain, Footprints, TreePine, PersonStanding } from "lucide-react"

const sports = [
  {
    id: "cycling",
    name: "Cycling",
    icon: Bike,
    color: "from-pink-400 to-pink-600",
    bgColor: "bg-pink-50 hover:bg-pink-100",
    description: "Road cycling adventures",
  },
  {
    id: "mtb",
    name: "Mountain Bike",
    icon: Mountain,
    color: "from-purple-400 to-purple-600",
    bgColor: "bg-purple-50 hover:bg-purple-100",
    description: "Off-road trails",
  },
  {
    id: "trail_running",
    name: "Trail Running",
    icon: TreePine,
    color: "from-teal-400 to-teal-600",
    bgColor: "bg-teal-50 hover:bg-teal-100",
    description: "Nature trail runs",
  },
  {
    id: "trekking",
    name: "Trekking",
    icon: Footprints,
    color: "from-orange-400 to-orange-600",
    bgColor: "bg-orange-50 hover:bg-orange-100",
    description: "Hiking adventures",
  },
  {
    id: "running",
    name: "Running",
    icon: PersonStanding,
    color: "from-rose-400 to-rose-600",
    bgColor: "bg-rose-50 hover:bg-rose-100",
    description: "Urban running groups",
  },
]

export function SportSelector() {
  const router = useRouter()

  const handleSportClick = (sportId: string) => {
    router.push(`/events?sport=${sportId}`)
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {sports.map((sport) => {
        const Icon = sport.icon
        return (
          <Card
            key={sport.id}
            className={`cursor-pointer transition-all hover:shadow-lg hover:scale-105 border-0 ${sport.bgColor}`}
            onClick={() => handleSportClick(sport.id)}
          >
            <CardContent className="p-6 flex flex-col items-center text-center space-y-3">
              <div
                className={`w-16 h-16 rounded-full bg-gradient-to-r ${sport.color} flex items-center justify-center`}
              >
                <Icon className="w-8 h-8 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-lg text-gray-800">{sport.name}</h3>
                <p className="text-sm text-gray-600">{sport.description}</p>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
