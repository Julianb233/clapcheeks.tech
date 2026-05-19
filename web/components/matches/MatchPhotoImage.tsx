'use client'

import { useState, type ImgHTMLAttributes } from 'react'

type Props = {
  src?: string | null
  alt: string
  initials?: string | null
  className?: string
  fallbackClassName?: string
  loading?: 'eager' | 'lazy'
  referrerPolicy?: ImgHTMLAttributes<HTMLImageElement>['referrerPolicy']
}

export default function MatchPhotoImage({
  src,
  alt,
  initials,
  className = 'h-full w-full object-cover',
  fallbackClassName = 'h-full w-full flex items-center justify-center text-white/30 text-4xl font-bold',
  loading = 'lazy',
  referrerPolicy = 'no-referrer',
}: Props) {
  const [failed, setFailed] = useState(false)
  const fallbackText = (initials || alt || '?').slice(0, 1).toUpperCase()

  if (!src || failed) {
    return <div className={fallbackClassName}>{fallbackText || '?'}</div>
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      referrerPolicy={referrerPolicy}
      onError={() => setFailed(true)}
      onLoad={(event) => {
        if (event.currentTarget.naturalWidth === 0) setFailed(true)
      }}
    />
  )
}
