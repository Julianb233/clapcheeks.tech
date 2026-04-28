/**
 * AI-8814 — AttributeChips component tests
 *
 * Tests:
 * 1. Renders chips for each category
 * 2. Allergy chips have red-border treatment
 * 3. Dismissal flow calls the API and updates state
 * 4. Empty attributes renders nothing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AttributeChips, { type MatchAttributes } from '../AttributeChips'

// Mock fetch for dismiss calls
const mockFetch = vi.fn()
global.fetch = mockFetch

const MOCK_ATTRIBUTES: MatchAttributes = {
  allergy: [
    { value: 'nut allergy', confidence: 1.0, source_msg_excerpt: 'I have a severe nut allergy', source_msg_index: 0 },
  ],
  dietary: [
    { value: 'vegan', confidence: 0.95, source_msg_excerpt: "I've been vegan for 3 years", source_msg_index: 1 },
    { value: 'sober', confidence: 0.90, source_msg_excerpt: "I don't drink at all", source_msg_index: 2 },
  ],
  schedule: [
    { value: 'morning person', confidence: 0.85, source_msg_excerpt: "I'm such a morning person", source_msg_index: 3 },
  ],
  lifestyle: [],
  logistics: [],
  comms: [
    { value: 'slow texter', confidence: 0.80, source_msg_excerpt: "I'm terrible at texting lol", source_msg_index: 5 },
  ],
  _dismissed: [],
}

describe('AttributeChips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders chips for each category with content', () => {
    render(
      <AttributeChips
        matchId="match-123"
        attributes={MOCK_ATTRIBUTES}
      />
    )

    expect(screen.getByText('nut allergy')).toBeTruthy()
    expect(screen.getByText('vegan')).toBeTruthy()
    expect(screen.getByText('sober')).toBeTruthy()
    expect(screen.getByText('morning person')).toBeTruthy()
    expect(screen.getByText('slow texter')).toBeTruthy()
  })

  it('renders nothing when attributes is empty', () => {
    const { container } = render(
      <AttributeChips
        matchId="match-123"
        attributes={{}}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when attributes is null', () => {
    const { container } = render(
      <AttributeChips
        matchId="match-123"
        attributes={null}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('allergy chip has warning icon', () => {
    render(
      <AttributeChips
        matchId="match-123"
        attributes={MOCK_ATTRIBUTES}
      />
    )

    // The allergy chip should have the ⚠ icon
    const allergyChip = screen.getByText('nut allergy').closest('button')
    expect(allergyChip?.textContent).toContain('⚠')
  })

  it('allergy chip has red border class', () => {
    render(
      <AttributeChips
        matchId="match-123"
        attributes={MOCK_ATTRIBUTES}
      />
    )

    const allergyChip = screen.getByText('nut allergy').closest('button')
    expect(allergyChip?.className).toMatch(/red/)
  })

  it('allergy is sorted before dietary chips', () => {
    render(
      <AttributeChips
        matchId="match-123"
        attributes={MOCK_ATTRIBUTES}
      />
    )

    const chips = screen.getAllByRole('button').filter(btn =>
      btn.getAttribute('aria-label')?.includes('—')
    )
    const firstChipLabel = chips[0]?.getAttribute('aria-label') || ''
    expect(firstChipLabel).toContain('allergy')
  })

  it('filters out low-confidence chips (< 0.60)', () => {
    const attrsWithLowConf: MatchAttributes = {
      dietary: [
        { value: 'maybe vegan', confidence: 0.35, source_msg_excerpt: '...', source_msg_index: 0 },
        { value: 'sober', confidence: 0.90, source_msg_excerpt: 'I do not drink', source_msg_index: 1 },
      ],
      allergy: [],
      schedule: [],
      lifestyle: [],
      logistics: [],
      comms: [],
    }

    render(<AttributeChips matchId="match-123" attributes={attrsWithLowConf} />)

    expect(screen.queryByText('maybe vegan')).toBeNull()
    expect(screen.getByText('sober')).toBeTruthy()
  })

  it('calls dismiss API on dismiss click and updates chips', async () => {
    const updatedAttrs: MatchAttributes = {
      allergy: [],
      dietary: [
        { value: 'vegan', confidence: 0.95, source_msg_excerpt: '...', source_msg_index: 1 },
        { value: 'sober', confidence: 0.90, source_msg_excerpt: '...', source_msg_index: 2 },
      ],
      schedule: [],
      lifestyle: [],
      logistics: [],
      comms: [],
      _dismissed: [{ category: 'allergy', value: 'nut allergy', dismissed_at: '2026-04-27T00:00:00Z' }],
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ attributes: updatedAttrs }),
    })

    const onAttributesChange = vi.fn()

    render(
      <AttributeChips
        matchId="match-123"
        attributes={MOCK_ATTRIBUTES}
        onAttributesChange={onAttributesChange}
      />
    )

    // Click the allergy chip to open popover
    const allergyChip = screen.getByText('nut allergy').closest('button')!
    fireEvent.click(allergyChip)

    // Click dismiss button
    const dismissBtn = await screen.findByText('Dismiss')
    fireEvent.click(dismissBtn)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/matches/match-123/attributes',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'dismiss', category: 'allergy', value: 'nut allergy' }),
        })
      )
    })

    await waitFor(() => {
      expect(onAttributesChange).toHaveBeenCalledWith(updatedAttrs)
    })

    // Allergy chip should be gone after dismiss
    await waitFor(() => {
      expect(screen.queryByText('nut allergy')).toBeNull()
    })
  })

  it('is non-interactive when interactive=false', () => {
    render(
      <AttributeChips
        matchId="match-123"
        attributes={MOCK_ATTRIBUTES}
        interactive={false}
      />
    )

    const veganChip = screen.getByText('vegan').closest('button')!
    fireEvent.click(veganChip)

    // No popover should appear
    expect(screen.queryByText('Dismiss')).toBeNull()
  })
})
