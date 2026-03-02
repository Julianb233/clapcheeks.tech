import { redirect } from 'next/navigation'

// All login flows now go through /login (dark-themed, styled page)
export default function AuthLoginRedirect() {
  redirect('/login')
}
