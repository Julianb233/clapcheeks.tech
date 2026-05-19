'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { clearOperatorSession, setOperatorSession, signInOperator } from '@/lib/auth/operator-session'

export async function login(formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const { user, error } = await signInOperator(email, password)

  if (error) {
    return { error }
  }
  if (!user) {
    return { error: 'Invalid login credentials' }
  }

  const session = await setOperatorSession(user)
  if (session.error) {
    return { error: session.error }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signup(_formData: FormData) {
  return { error: 'Public signup is disabled for this operator dashboard' }
}

export async function loginWithGoogle() {
  redirect(`/login?error=${encodeURIComponent('Google login is not configured. Use email and password.')}`)
}

export async function logout() {
  await clearOperatorSession()
  revalidatePath('/', 'layout')
  redirect('/')
}
