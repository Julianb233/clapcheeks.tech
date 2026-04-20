'use client'

import { useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { MatchPhoto } from '@/lib/matches/types'

type Props = {
  photos: MatchPhoto[]
  name?: string | null
}

export default function PhotoGallery({ photos, name }: Props) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: photos.length > 1, dragFree: false })
  const [index, setIndex] = useState(0)
  const touch = useRef({ x: 0 })

  useEffect(() => {
    if (!emblaApi) return
    const onSelect = () => setIndex(emblaApi.selectedScrollSnap())
    emblaApi.on('select', onSelect)
    return () => {
      emblaApi.off('select', onSelect)
    }
  }, [emblaApi])

  if (!photos || photos.length === 0) {
    return (
      <div className="relative w-full aspect-[3/4] bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-xl border border-white/10 flex items-center justify-center">
        <div className="text-white/30 text-6xl font-bold">
          {(name ?? '?').slice(0, 1).toUpperCase()}
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <div
        className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900"
        ref={emblaRef}
        onTouchStart={(e) => {
          touch.current.x = e.touches[0]?.clientX ?? 0
        }}
      >
        <div className="flex">
          {photos.map((p, i) => (
            <div
              key={i}
              className="relative flex-[0_0_100%] aspect-[3/4] bg-zinc-900"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt={name ? `${name} photo ${i + 1}` : `Photo ${i + 1}`}
                className="w-full h-full object-cover"
                loading={i === 0 ? 'eager' : 'lazy'}
              />
            </div>
          ))}
        </div>
      </div>
      {photos.length > 1 && (
        <>
          <div className="absolute top-2 left-0 right-0 flex gap-1 px-2">
            {photos.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-all ${
                  i === index ? 'bg-white' : 'bg-white/30'
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => emblaApi?.scrollPrev()}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 backdrop-blur border border-white/20 text-white hover:bg-black/70 flex items-center justify-center"
            aria-label="Previous photo"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => emblaApi?.scrollNext()}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/50 backdrop-blur border border-white/20 text-white hover:bg-black/70 flex items-center justify-center"
            aria-label="Next photo"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur border border-white/10 text-white/80 text-[10px] font-mono px-2 py-0.5 rounded">
            {index + 1} / {photos.length}
          </div>
        </>
      )}
    </div>
  )
}
