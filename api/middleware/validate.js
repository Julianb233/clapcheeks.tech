export const VALID_PLATFORMS = ['tinder', 'hinge', 'bumble', 'match', 'okcupid', 'coffee_meets_bagel', 'plenty_of_fish', 'happn', 'thursday', 'imessage', 'grindr', 'badoo', 'pof', 'feeld', 'cmb']
const MAX_TEXT_LENGTH = 2000

export function validatePlatform(req, res, next) {
  const platform = req.body.platform || req.query.platform
  if (platform && !VALID_PLATFORMS.includes(platform.toLowerCase())) {
    return res.status(400).json({
      error: 'Invalid platform',
      valid_platforms: VALID_PLATFORMS,
    })
  }
  next()
}

export function validateTextLength(fields) {
  return (req, res, next) => {
    for (const field of fields) {
      const val = req.body[field]
      if (val && typeof val === 'string' && val.length > MAX_TEXT_LENGTH) {
        return res.status(400).json({
          error: `${field} exceeds maximum length of ${MAX_TEXT_LENGTH} characters`,
        })
      }
    }
    next()
  }
}
