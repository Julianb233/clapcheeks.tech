import type { IdeaCategory, DateVibe } from './types'

interface IdeaTemplate {
  title: string
  description: string
  category: IdeaCategory
  estimated_cost_range: string
  duration_minutes: number
  best_for: DateVibe[]
  location_type: 'indoor' | 'outdoor' | 'both'
}

const IDEA_TEMPLATES: IdeaTemplate[] = [
  // Adventure
  { title: 'Rock Climbing Gym', description: 'Try indoor bouldering together — great for building trust and showing athleticism.', category: 'adventure', estimated_cost_range: '$$', duration_minutes: 120, best_for: ['adventurous', 'casual'], location_type: 'indoor' },
  { title: 'Kayaking at Sunset', description: 'Tandem kayak on calm water during golden hour.', category: 'adventure', estimated_cost_range: '$$', duration_minutes: 90, best_for: ['romantic', 'adventurous'], location_type: 'outdoor' },
  { title: 'Escape Room', description: 'Team up to solve puzzles — reveals communication styles naturally.', category: 'adventure', estimated_cost_range: '$$', duration_minutes: 60, best_for: ['first_date', 'casual'], location_type: 'indoor' },
  { title: 'Hiking to a Viewpoint', description: 'Pick a trail with a rewarding view at the top. Pack snacks.', category: 'adventure', estimated_cost_range: '$', duration_minutes: 180, best_for: ['casual', 'adventurous'], location_type: 'outdoor' },
  // Food
  { title: 'Cooking Class Together', description: 'Learn to make pasta, sushi, or cocktails side by side.', category: 'food', estimated_cost_range: '$$$', duration_minutes: 150, best_for: ['romantic', 'casual'], location_type: 'indoor' },
  { title: 'Food Truck Crawl', description: 'Hit 3-4 food trucks in one night. Share bites, no pressure.', category: 'food', estimated_cost_range: '$$', duration_minutes: 120, best_for: ['first_date', 'casual'], location_type: 'outdoor' },
  { title: 'Farmers Market + Home Cook', description: 'Shop together at the market, then cook a meal at home.', category: 'food', estimated_cost_range: '$$', duration_minutes: 180, best_for: ['romantic', 'casual'], location_type: 'both' },
  { title: 'Speakeasy Bar Hop', description: 'Find 2-3 hidden cocktail bars. Dress up, keep it mysterious.', category: 'food', estimated_cost_range: '$$$', duration_minutes: 150, best_for: ['romantic', 'adventurous'], location_type: 'indoor' },
  // Creative
  { title: 'Pottery Class', description: 'Get your hands dirty together — the Ghost scene writes itself.', category: 'creative', estimated_cost_range: '$$', duration_minutes: 120, best_for: ['romantic', 'casual'], location_type: 'indoor' },
  { title: 'Paint & Sip', description: 'Canvas painting with wine. Low pressure, easy conversation.', category: 'creative', estimated_cost_range: '$$', duration_minutes: 120, best_for: ['first_date', 'casual'], location_type: 'indoor' },
  { title: 'Record Store + Vinyl Listening', description: 'Browse vinyl together, then listen to picks at a cafe.', category: 'creative', estimated_cost_range: '$', duration_minutes: 90, best_for: ['first_date', 'casual'], location_type: 'indoor' },
  // Nightlife
  { title: 'Live Jazz Night', description: 'Intimate jazz club with cocktails. Classy and conversation-friendly.', category: 'nightlife', estimated_cost_range: '$$', duration_minutes: 150, best_for: ['romantic', 'first_date'], location_type: 'indoor' },
  { title: 'Rooftop Bar', description: 'City views, sunset drinks, effortless vibe.', category: 'nightlife', estimated_cost_range: '$$', duration_minutes: 120, best_for: ['first_date', 'romantic'], location_type: 'outdoor' },
  { title: 'Comedy Show', description: 'Shared laughter is instant bonding. Book front-row if brave.', category: 'nightlife', estimated_cost_range: '$$', duration_minutes: 90, best_for: ['first_date', 'casual'], location_type: 'indoor' },
  // Outdoors
  { title: 'Beach Sunset Picnic', description: 'Blanket, wine, charcuterie. Classic for a reason.', category: 'outdoors', estimated_cost_range: '$', duration_minutes: 120, best_for: ['romantic', 'casual'], location_type: 'outdoor' },
  { title: 'Bike Ride Along the Coast', description: 'Rent bikes and cruise. Stop for coffee or ice cream.', category: 'outdoors', estimated_cost_range: '$', duration_minutes: 120, best_for: ['casual', 'adventurous'], location_type: 'outdoor' },
  { title: 'Stargazing Drive', description: 'Drive out of the city, bring blankets, watch the stars.', category: 'outdoors', estimated_cost_range: '$', duration_minutes: 180, best_for: ['romantic', 'adventurous'], location_type: 'outdoor' },
  // Cultural
  { title: 'Museum + Coffee Debrief', description: 'Art museum followed by a cafe to discuss favorites.', category: 'cultural', estimated_cost_range: '$$', duration_minutes: 150, best_for: ['first_date', 'casual'], location_type: 'indoor' },
  { title: 'Bookstore Date', description: 'Pick a book for each other. Reveals personality fast.', category: 'cultural', estimated_cost_range: '$', duration_minutes: 90, best_for: ['first_date', 'casual'], location_type: 'indoor' },
  // Chill
  { title: 'Coffee Walk', description: 'Low investment first meeting. Walk and talk with lattes.', category: 'chill', estimated_cost_range: '$', duration_minutes: 60, best_for: ['first_date'], location_type: 'both' },
  { title: 'Movie Night In', description: 'Pick a film neither has seen. Homemade popcorn.', category: 'chill', estimated_cost_range: '$', duration_minutes: 150, best_for: ['casual', 'romantic'], location_type: 'indoor' },
  { title: 'Board Game Cafe', description: 'Competitive and playful. Great for reading someone.', category: 'chill', estimated_cost_range: '$', duration_minutes: 120, best_for: ['first_date', 'casual'], location_type: 'indoor' },
  // Surprise
  { title: 'Mystery Envelope Date', description: 'Put 3 options in envelopes. They pick one. Spontaneous energy.', category: 'surprise', estimated_cost_range: '$$', duration_minutes: 120, best_for: ['adventurous', 'romantic'], location_type: 'both' },
  { title: 'Yes Day', description: 'Take turns saying yes to whatever the other suggests for 3 hours.', category: 'surprise', estimated_cost_range: '$$', duration_minutes: 180, best_for: ['adventurous', 'casual'], location_type: 'both' },
]

interface GenerateOptions {
  vibes?: DateVibe[]
  categories?: IdeaCategory[]
  budget?: string // '$', '$$', '$$$'
  count?: number
}

export function generateDateIdeas(options: GenerateOptions = {}): IdeaTemplate[] {
  const { vibes, categories, budget, count = 5 } = options

  let filtered = [...IDEA_TEMPLATES]

  if (vibes && vibes.length > 0) {
    filtered = filtered.filter(idea =>
      idea.best_for.some(v => vibes.includes(v))
    )
  }

  if (categories && categories.length > 0) {
    filtered = filtered.filter(idea => categories.includes(idea.category))
  }

  if (budget) {
    const maxLevel = budget.length // '$' = 1, '$$' = 2, '$$$' = 3
    filtered = filtered.filter(idea => idea.estimated_cost_range.length <= maxLevel)
  }

  // Shuffle and pick
  const shuffled = filtered.sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

export function getIdeaCategories(): { value: IdeaCategory; label: string; emoji: string }[] {
  return [
    { value: 'adventure', label: 'Adventure', emoji: '🧗' },
    { value: 'food', label: 'Food & Drinks', emoji: '🍽️' },
    { value: 'creative', label: 'Creative', emoji: '🎨' },
    { value: 'nightlife', label: 'Nightlife', emoji: '🌃' },
    { value: 'outdoors', label: 'Outdoors', emoji: '🏖️' },
    { value: 'cultural', label: 'Cultural', emoji: '🏛️' },
    { value: 'chill', label: 'Chill', emoji: '☕' },
    { value: 'surprise', label: 'Surprise', emoji: '🎁' },
  ]
}

export function getVibeOptions(): { value: DateVibe; label: string }[] {
  return [
    { value: 'first_date', label: 'First Date' },
    { value: 'casual', label: 'Casual' },
    { value: 'romantic', label: 'Romantic' },
    { value: 'adventurous', label: 'Adventurous' },
  ]
}
