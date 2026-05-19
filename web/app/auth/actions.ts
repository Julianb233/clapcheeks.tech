'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/convex/server'

export async function login(formData: FormData) {
  const convex = await createClient()

  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { error } = await convex.auth.signInWithPassword(data)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signup(formData: FormData) {
  const convex = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('full_name') as string
  const ref = formData.get('ref') as string | null

  const { data, error } = await convex.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        ...(ref ? { referred_by: ref } : {}),
      },
    },
  })

  if (error) {
    return { error: error.message }
  }

  // If there's a referral code and user was created, store it on their profile
  if (ref && data.user) {
    await convex
      .from('profiles')
      .update({ referred_by: ref })
      .eq('id', data.user.id)
  }

  revalidatePath('/', 'layout')
  redirect('/onboarding')
}

export async function loginWithGoogle() {
  const convex = await createClient()

  const { data, error } = await convex.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/auth/callback`,
    },
  })

  if (error) {
    redirect('/login?error=Could not authenticate with Google')
  }

  if (data.url) {
    redirect(data.url)
  }
}

export async function logout() {
  const convex = await createClient()
  await convex.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}
