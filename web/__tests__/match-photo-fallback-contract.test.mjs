import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = {
  photos: readFileSync('lib/matches/photos.ts', 'utf8'),
  image: readFileSync('components/matches/MatchPhotoImage.tsx', 'utf8'),
  matches: readFileSync('app/(main)/matches/page.tsx', 'utf8'),
  detail: readFileSync('app/(main)/matches/[id]/match-profile-view.tsx', 'utf8'),
  compat: readFileSync('lib/convex/compat-client.ts', 'utf8'),
}

test('match photo normalization accepts canonical and mirrored photo URL fields', () => {
  for (const field of [
    'url',
    'supabase_url',
    'supabaseUrl',
    'convex_url',
    'convexUrl',
    'public_url',
    'publicUrl',
    'signed_url',
    'signedUrl',
    'image_url',
    'imageUrl',
    'cdn_url',
    'cdnUrl',
    'raw_url',
    'rawUrl',
    'src',
  ]) {
    assert.match(files.photos, new RegExp(`'${field}'`))
  }

  assert.match(files.photos, /normalizeMatchPhotos/)
  assert.match(files.photos, /seen\.has\(url\)/)
  assert.match(files.photos, /getCoverPhoto/)
})

test('match image UI falls back instead of leaving stale Hinge images broken', () => {
  assert.match(files.image, /onError=\{\(\) => setFailed\(true\)\}/)
  assert.match(files.image, /naturalWidth === 0/)
  assert.match(files.image, /fallbackClassName/)
  assert.match(files.matches, /<MatchPhotoImage/)
  assert.match(files.detail, /normalizeMatchPhotos/)
  assert.match(files.detail, /<MatchPhotoImage/)
})

test('Convex compatibility writes preserve dashboard photos_jsonb fields', () => {
  assert.match(files.compat, /normalizeMatchPhotos/)
  assert.match(files.compat, /row\.photos_jsonb/)
  assert.match(files.compat, /photos: normalizeMatchPhotos\(sourcePhotos\)/)
})
