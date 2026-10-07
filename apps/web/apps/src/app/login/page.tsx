'use client'

import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/AuthContext'
import { showToast } from '@/lib/toast'
import { MAX_TEXT_LENGTH, MAX_EMAIL_LENGTH, sanitizeNoWhitespace, validateEmailFormat } from '@/lib/inputValidation'

export default function LoginPage() {
  const router = useRouter()
  const { user, loading: authLoading, login, verifyLoginOtp, resendLoginOtp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otpDigits, setOtpDigits] = useState<string[]>(() => Array(6).fill(''))
  const [otpToken, setOtpToken] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [isOtpLoginMode, setIsOtpLoginMode] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isResendingOtp, setIsResendingOtp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([])
  const otp = otpDigits.join('')

  useEffect(() => {
    const saved = localStorage.getItem('rememberMe')
    if (saved === 'true') setRememberMe(true)
  }, [])

  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/dashboard')
    }
  }, [authLoading, user, router])

  const resetOtpChallenge = () => {
    setOtpToken(null)
    setOtpDigits(Array(6).fill(''))
  }

  const completeLogin = async () => {
    if (rememberMe) {
      localStorage.setItem('rememberMe', 'true')
    } else {
      localStorage.removeItem('rememberMe')
    }

    showToast.info('Signing in...')
    await new Promise((r) => setTimeout(r, 500))
    showToast.success('Welcome back!')
    router.push('/dashboard')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const emailCheck = validateEmailFormat(email)
    if (!emailCheck.isValid) {
      setError(emailCheck.error || 'Please enter a valid email address')
      return
    }

    if (otpToken) {
      if (!/^\d{6}$/.test(otp)) {
        setError('Please enter the 6-digit verification code sent to your email')
        return
      }
    } else if (isOtpLoginMode) {
      if (!/^\d{6}$/.test(otp)) {
        setError('Please enter the 6-digit OTP sent when your account was created')
        return
      }
    } else if (!password) {
      setError('Please enter your email and password')
      return
    }

    setIsLoading(true)

    try {
      if (otpToken) {
        await verifyLoginOtp(otpToken, otp)
        await completeLogin()
        return
      }

      const result = await login(
        email,
        isOtpLoginMode ? undefined : password,
        rememberMe,
        isOtpLoginMode ? otp : undefined,
      )

      if (result.otpRequired) {
        setOtpToken(result.otpToken)
        setOtpDigits(Array(6).fill(''))
        setPassword('')
        showToast.success(result.message || 'Verification code sent.')
        return
      }

      await completeLogin()
    } catch (err: unknown) {
      console.error('Login failed:', err)
      const parsed = err as { message?: string }
      const msg = parsed.message || ''
      if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')) {
        setError('Unable to connect to the server. Please try again later.')
        showToast.error('Unable to connect to the server.')
      } else {
        setError(msg || 'Invalid credentials. Please try again.')
        showToast.error(msg || 'Login failed. Check credentials.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleResendOtp = async () => {
    if (!otpToken) return

    setError(null)
    setIsResendingOtp(true)
    try {
      await resendLoginOtp(otpToken)
      showToast.success('A new verification code has been sent.')
    } catch (err: unknown) {
      console.error('Resend login OTP failed:', err)
      const parsed = err as { message?: string }
      const msg = parsed.message || 'Failed to resend verification code. Please try again.'
      setError(msg)
      showToast.error(msg)
    } finally {
      setIsResendingOtp(false)
    }
  }

  const isChallengeMode = !!otpToken

  const handleOtpModeToggle = () => {
    setIsOtpLoginMode((prev) => !prev)
    setPassword('')
    setOtpDigits(Array(6).fill(''))
    setError(null)
    resetOtpChallenge()
  }

  const handleUseDifferentCredentials = () => {
    resetOtpChallenge()
    setPassword('')
    setError(null)
  }

  const handleOtpDigitChange = (index: number, rawValue: string) => {
    if (isLoading) return
    const digit = rawValue.replace(/\D/g, '').slice(-1)
    const next = [...otpDigits]
    next[index] = digit || ''
    setOtpDigits(next)
    if (digit && index < 5) {
      otpInputRefs.current[index + 1]?.focus()
    }
  }

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      otpInputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowRight' && index < 5) {
      e.preventDefault()
      otpInputRefs.current[index + 1]?.focus()
    }
  }

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    const next = Array(6).fill('') as string[]
    pasted.split('').forEach((digit, index) => {
      next[index] = digit
    })
    setOtpDigits(next)
    const focusIndex = Math.min(pasted.length, 6) - 1
    if (focusIndex >= 0) {
      otpInputRefs.current[focusIndex]?.focus()
    }
  }

  if (authLoading || user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-[#226538] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-gray-600">Checking session...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[url('/images/picW.png')] bg-cover bg-center"></div>
          <div className="absolute inset-0 bg-[#226538]/80"></div>
        </div>

        <div className="relative z-10 flex flex-col justify-center items-center text-center p-12 text-white h-full w-full">
          <h1 className="text-5xl font-extrabold mb-2">
            <span className="text-white">Kapit-</span>
            <span className="text-[#ECC323]">Bisig</span>
          </h1>
          <p className="text-xl font-light mb-12 leading-relaxed max-w-md">
            AI-Powered Household Relief
            <br />
            Distribution and Tracking Platform
            <br />
            for Local Government Units
          </p>

          <div className="grid grid-cols-2 gap-4 max-w-md w-full">
            <FeatureCard title="Precise" description="Data Driven aid Delivery" />
            <FeatureCard title="Equitable" description="Fairness Through AI Prioritization" />
            <FeatureCard title="Transparent" description="Digital relief Tracking" />
            <FeatureCard title="Resilient" description="Strengthening LGU disaster response" />
          </div>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <Image
              src="/images/logoW.png"
              alt="Kapit-Bisig Logo"
              width={280}
              height={100}
              style={{ width: 'auto', height: 'auto' }}
              priority
            />
          </div>

          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              {isChallengeMode ? 'Verify Sign In' : 'Welcome Back!'}
            </h1>
              <p className="text-gray-600 text-sm font-medium">
              {isChallengeMode
                ? 'Enter the 6-digit code sent to your registered Gmail address.'
                : 'Enter your account credentials. Superadmin sign-in requires a one-time email code.'}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm text-center">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="flex items-center justify-between">
              {!isChallengeMode ? (
                <button
                  type="button"
                  onClick={handleOtpModeToggle}
                  className="text-sm text-[#226538] hover:text-[#1b502d] font-medium"
                >
                  {isOtpLoginMode ? 'Use password instead' : 'First-time staff? Sign in with OTP'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleUseDifferentCredentials}
                  className="text-sm text-[#226538] hover:text-[#1b502d] font-medium"
                >
                  Use different credentials
                </button>
              )}
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
                {'Email'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <input
                  type="text"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(sanitizeNoWhitespace(e.target.value, MAX_EMAIL_LENGTH))}
                  maxLength={MAX_EMAIL_LENGTH}
                  placeholder="Enter your registered email"
                  className="block w-full pl-10 pr-3 py-3 bg-transparent border-b-2 border-gray-300 focus:outline-none focus:border-[#226538] transition-colors text-gray-900 disabled:opacity-60 disabled:cursor-not-allowed"
                  required
                  disabled={isLoading || isChallengeMode}
                  autoComplete="email"
                />
              </div>
            </div>

            {!isOtpLoginMode && !isChallengeMode && (
              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(sanitizeNoWhitespace(e.target.value))}
                    maxLength={MAX_TEXT_LENGTH}
                    placeholder="........"
                    className="block w-full pl-10 pr-12 py-3 bg-transparent border-b-2 border-gray-300 focus:outline-none focus:border-[#226538] transition-colors text-gray-900 disabled:opacity-60 disabled:cursor-not-allowed"
                    required
                    disabled={isLoading}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l18 18" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            )}

            {(isOtpLoginMode || isChallengeMode) && (
              <div>
                <label htmlFor="otp" className="block text-sm font-semibold text-gray-700 mb-2">
                  {isChallengeMode ? 'Email Verification Code' : 'One-Time Password (OTP)'}
                </label>
                <div className="flex items-center gap-2">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <input
                      key={index}
                      ref={(el) => {
                        otpInputRefs.current[index] = el
                      }}
                      type="text"
                      id={index === 0 ? 'otp' : undefined}
                      value={otpDigits[index] ?? ''}
                      onChange={(e) => handleOtpDigitChange(index, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(index, e)}
                      onPaste={handleOtpPaste}
                      className="h-12 w-12 text-center text-lg font-semibold bg-transparent border-b-2 border-gray-300 focus:outline-none focus:border-[#226538] transition-colors text-gray-900 disabled:opacity-60 disabled:cursor-not-allowed"
                      required
                      disabled={isLoading}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={1}
                      aria-label={`OTP digit ${index + 1}`}
                    />
                  ))}
                </div>
                {isChallengeMode && (
                  <p className="mt-2 text-xs text-gray-500">
                    Complete sign-in by entering the code sent after your password was verified.
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="remember"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 text-[#226538] focus:ring-[#226538] border-gray-300 rounded cursor-pointer accent-[#226538]"
                  disabled={isLoading}
                />
                <label htmlFor="remember" className="ml-2 text-sm text-gray-600 cursor-pointer">
                  Remember me
                </label>
              </div>
              {!isOtpLoginMode && !isChallengeMode && (
                <a href="/forgot-password" className="text-sm text-[#ECC323] hover:text-yellow-600 font-medium">
                  Forgot password?
                </a>
              )}
            </div>

            {isChallengeMode && (
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={isLoading || isResendingOtp}
                  className="text-[#226538] hover:text-[#1b502d] font-medium disabled:opacity-60"
                >
                  {isResendingOtp ? 'Sending...' : 'Resend code'}
                </button>
                <span className="text-gray-500">Code expires in 10 minutes</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-[#226538] hover:bg-[#1b502d] text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#226538] focus:ring-offset-2 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 transform hover:scale-105"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Signing in...
                </>
              ) : (
                isChallengeMode ? 'Verify code' : 'Sign in'
              )}
            </button>

          </form>
        </div>
      </div>
    </div>
  )
}

function FeatureCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className={`bg-black/20 backdrop-blur-sm rounded-xl p-4 border border-white/10 hover:scale-105 transition-transform cursor-default shadow-lg`}>
      <h3 className="text-lg font-bold text-[#ECC323] mb-1">{title}</h3>
      <p className="text-xs text-white/90 leading-relaxed">{description}</p>
    </div>
  )
}

