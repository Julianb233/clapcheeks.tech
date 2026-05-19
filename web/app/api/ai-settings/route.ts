import { NextRequest, NextResponse } from "next/server"
import {
  getClapCheeksUserSettings,
  upsertClapCheeksUserSettings,
} from "@/lib/clapcheeks/user-settings"

export async function GET() {
  try {
    const settings = await getClapCheeksUserSettings()
    return NextResponse.json(settings)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Body must be an object" }, { status: 400 })
    }
    const row = await upsertClapCheeksUserSettings(body)
    return NextResponse.json({ row })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
