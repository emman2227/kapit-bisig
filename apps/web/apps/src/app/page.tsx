import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default function Home() {
  const cookieStore = cookies()
  const token = cookieStore.get('sa_token')?.value

  if (token) {
    redirect('/dashboard')
  }

  redirect('/login')
}
