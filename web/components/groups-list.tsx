"use client"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Users, Shield, Lock } from "lucide-react"
import Link from "next/link"

type Group = {
  id: string
  name: string
  description: string
  sport_type: string
  is_private: boolean
  max_members: number
  current_members: number
  leader: {
    full_name: string
    display_name: string
    is_verified: boolean
    reputation_score: number
  }
}

const sportColors: Record<string, string> = {
  cycling: "from-pink-400 to-pink-600",
  mtb: "from-purple-400 to-purple-600",
  trail_running: "from-teal-400 to-teal-600",
  trekking: "from-orange-400 to-orange-600",
  running: "from-rose-400 to-rose-600",
}

export function GroupsList({ groups }: { groups: Group[] }) {
  if (groups.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-lg text-gray-600">No groups found. Be the first to create one!</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {groups.map((group) => (
        <Link key={group.id} href={`/groups/${group.id}`}>
          <Card className="hover:shadow-lg transition-all hover:scale-[1.02] cursor-pointer border-0 bg-white/80 backdrop-blur h-full">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-lg text-gray-800 line-clamp-2">{group.name}</h3>
                <div
                  className={`w-10 h-10 rounded-full bg-gradient-to-r ${sportColors[group.sport_type]} flex-shrink-0`}
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                  {group.sport_type.replace("_", " ")}
                </Badge>
                {group.is_private && (
                  <Badge variant="outline" className="bg-gray-100 text-gray-700 border-gray-200">
                    <Lock className="w-3 h-3 mr-1" />
                    Private
                  </Badge>
                )}
                {group.leader.is_verified && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    <Shield className="w-3 h-3 mr-1" />
                    Verified
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-600 line-clamp-3">{group.description}</p>

              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Users className="w-4 h-4" />
                <span>
                  {group.current_members}/{group.max_members || "∞"} members
                </span>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs text-gray-500">Led by {group.leader.display_name || group.leader.full_name}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}
