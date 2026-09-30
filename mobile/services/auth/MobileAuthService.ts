/**
 * Mobile Authentication Service
 *
 * Handles volunteer authentication for the mobile app.
 * Volunteers are created by Admins/Staff in the web app
 * and use these credentials to log in to the mobile app.
 *
 * Features:
 * - Secure login with JWT tokens
 * - Token storage using SecureStore
 * - Auto token refresh
 * - Role validation (Volunteer or LGU staff)
 */

import * as SecureStore from 'expo-secure-store';
import { resolveApiBaseUrl } from '../config/apiSecurity';

// Configuration
const API_CONFIG = {
  baseUrl: resolveApiBaseUrl(
    process.env.EXPO_PUBLIC_API_URL,
    'https://kapit-bisig.onrender.com/api',
    'MobileAuthService',
  ),
  timeout: 15000,
};

// Storage keys
const STORAGE_KEYS = {
  AUTH_TOKEN: 'kapit_bisig_auth_token',
  USER_DATA: 'kapit_bisig_user_data',
};

// Legacy invalid keys (had "@" prefix and can throw on some platforms)
const LEGACY_STORAGE_KEYS = {
  AUTH_TOKEN: '@kapit_bisig_auth_token',
  USER_DATA: '@kapit_bisig_user_data',
};

/**
 * User Role type
 */
export type UserRole = 'Admin' | 'Staff' | 'Volunteer' | 'LGU_STAFF';

/**
 * User Status type
 */
export type UserStatus = 'Active' | 'Inactive' | 'Suspended';

/**
 * User interface
 */
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  barangay?: string;
  assignedBarangays?: string[];
  phoneNumber?: string;
  lastLogin?: string;
}

export interface UpdateMobileProfilePayload {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
}

export interface DashboardSummary {
  scopedBarangays: string[];
  residents: {
    total: number;
    approved: number;
    pending: number;
    rejected: number;
  };
  distributions: {
    total: number;
    active: number;
  };
  claims: {
    confirmedToday: number;
  };
  scans: {
    today: number;
    yesterday: number;
    trend: number;
  };
}

/**
 * Auth Response interface
 */
export interface AuthResponse {
  success: boolean;
  message?: string;
  otpRequired?: boolean;
  otpToken?: string;
  data?: {
    user: User;
    token: string;
  };
  code?: string;
}

/**
 * API Error interface
 */
export interface PasswordRecoveryResponse {
  success: boolean;
  message?: string;
  resetToken?: string;
  code?: string;
}

export interface ApiError {
  success: false;
  message: string;
  code?: string;
}

/**
 * Mobile Authentication Service Class
 */
class MobileAuthService {
  private token: string | null = null;
  private user: User | null = null;
  private isInitialized = false;

  /**
   * Initialize the auth service
   * Call this when the app starts to restore saved session
   */
  async initialize(): Promise<boolean> {
    try {
      await this.migrateLegacyKeys();

      const [storedToken, storedUser] = await Promise.all([
        this.getStoredItem(STORAGE_KEYS.AUTH_TOKEN),
        this.getStoredItem(STORAGE_KEYS.USER_DATA),
      ]);

      if (storedToken && storedUser) {
        this.token = storedToken;
        this.user = JSON.parse(storedUser);

        // Validate the token is still valid
        const isValid = await this.validateToken();
        if (!isValid) {
          await this.logout();
          this.isInitialized = true;
          return false;
        }

        this.isInitialized = true;
        return true;
      }

      this.isInitialized = true;
      return false;
    } catch (error) {
      console.error('[MobileAuthService] Initialization error:', error);
      this.isInitialized = true;
      return false;
    }
  }

  /**
   * Check if user is logged in
   */
  isLoggedIn(): boolean {
    return !!this.token && !!this.user;
  }

  /**
   * Get current user
   */
  getCurrentUser(): User | null {
    return this.user;
  }

  /**
   * Get auth token
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Login with email and password
   * Allows Volunteer and LGU staff users
   */
  async login(email: string, password: string): Promise<AuthResponse> {
    try {
      // Validate inputs
      if (!email || !password) {
        return {
          success: false,
          message: 'Email and password are required',
        };
      }

      const response = await fetch(`${API_CONFIG.baseUrl}/mobile-auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.toLowerCase(), password }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Login failed',
          code: data.code,
        };
      }

      if (data.otpRequired) {
        return {
          success: true,
          otpRequired: true,
          otpToken: data.otpToken,
          message: data.message || 'Verification code sent.',
        };
      }

      if (!data.success || !data.data) {
        return {
          success: false,
          message: data.message || 'Invalid response from server',
        };
      }

      const { user, token } = data.data;

      // Validate role - mobile supports Volunteer and LGU staff accounts
      if (user.role !== 'Volunteer' && user.role !== 'LGU_STAFF') {
        return {
          success: false,
          message: 'This account is not allowed to use the mobile app.',
          code: 'INVALID_ROLE',
        };
      }

      // Store credentials
      await this.storeCredentials(token, user);

      return {
        success: true,
        message: 'Login successful',
        data: { user, token },
      };
    } catch (error) {
      console.error('[MobileAuthService] Login error:', error);
      return {
        success: false,
        message: `Unable to reach API server at ${API_CONFIG.baseUrl}. Make sure backend is running and EXPO_PUBLIC_API_URL is reachable from your device.`,
        code: 'NETWORK_ERROR',
      };
    }
  }

  async verifyLoginOtp(otpToken: string, otp: string): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_CONFIG.baseUrl}/mobile-auth/login/verify-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ otpToken, otp }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'OTP verification failed',
          code: data.code,
        };
      }

      if (!data.success || !data.data) {
        return {
          success: false,
          message: data.message || 'Invalid response from server',
        };
      }

      const { user, token } = data.data;

      if (user.role !== 'Volunteer' && user.role !== 'LGU_STAFF') {
        return {
          success: false,
          message: 'This account is not allowed to use the mobile app.',
          code: 'INVALID_ROLE',
        };
      }

      await this.storeCredentials(token, user);

      return {
        success: true,
        message: data.message || 'Login successful',
        data: { user, token },
      };
    } catch (error) {
      console.error('[MobileAuthService] OTP verification error:', error);
      return {
        success: false,
        message: `Unable to reach API server at ${API_CONFIG.baseUrl}. Make sure backend is running and EXPO_PUBLIC_API_URL is reachable from your device.`,
        code: 'NETWORK_ERROR',
      };
    }
  }

  async resendLoginOtp(otpToken: string): Promise<{ success: boolean; message?: string; code?: string }> {
    try {
      const response = await fetch(`${API_CONFIG.baseUrl}/mobile-auth/login/resend-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ otpToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to resend OTP',
          code: data.code,
        };
      }

      return {
        success: true,
        message: data.message || 'A new verification code has been sent.',
      };
    } catch (error) {
      console.error('[MobileAuthService] OTP resend error:', error);
      return {
        success: false,
        message: `Unable to reach API server at ${API_CONFIG.baseUrl}. Make sure backend is running and EXPO_PUBLIC_API_URL is reachable from your device.`,
        code: 'NETWORK_ERROR',
      };
    }
  }

  /**
   * Verify first-time login activation OTP
   */
  async verifyFirstLoginOtp(
    email: string,
    otp: string,
  ): Promise<{ success: boolean; activationToken?: string; message?: string; code?: string }> {
    try {
      const response = await fetch(`${API_CONFIG.baseUrl}/mobile-auth/first-login/verify-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp: otp.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'OTP verification failed',
          code: data.code,
        };
      }

      return {
        success: true,
        activationToken: data.activationToken,
        message: data.message || 'Code verified successfully',
      };
    } catch (error) {
      console.error('[MobileAuthService] First-login OTP verify error:', error);
      return {
        success: false,
        message: 'Unable to reach the server. Please check your network connection.',
        code: 'NETWORK_ERROR',
      };
    }
  }

  /**
   * Set initial password during first-time login
   */
  async firstLoginSetPassword(activationToken: string, newPassword: string): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_CONFIG.baseUrl}/mobile-auth/first-login/set-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ activationToken, newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to set password',
          code: data.code,
        };
      }

      if (!data.success || !data.data) {
        return {
          success: false,
          message: data.message || 'Invalid response from server',
        };
      }

      const { user, token } = data.data;

      if (user.role !== 'Volunteer' && user.role !== 'LGU_STAFF') {
        return {
          success: false,
          message: 'This account is not allowed to use the mobile app.',
          code: 'INVALID_ROLE',
        };
      }

      await this.storeCredentials(token, user);

      return {
        success: true,
        message: data.message || 'Password set successfully',
        data: { user, token },
      };
    } catch (error) {
      console.error('[MobileAuthService] First-login set password error:', error);
      return {
        success: false,
        message: 'Unable to reach the server. Please check your network connection.',
        code: 'NETWORK_ERROR',
      };
    }
  }

  /**
   * Resend first-time login activation OTP
   */
  async resendFirstLoginOtp(email: string): Promise<{ success: boolean; message?: string; code?: string }> {
    try {
      const response = await fetch(`${API_CONFIG.baseUrl}/mobile-auth/first-login/resend-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to resend activation code',
          code: data.code,
        };
      }

      return {
        success: true,
        message: data.message || 'A new verification code has been sent.',
      };
    } catch (error) {
      console.error('[MobileAuthService] First-login OTP resend error:', error);
      return {
        success: false,
        message: 'Unable to reach the server. Please check your network connection.',
        code: 'NETWORK_ERROR',
      };
    }
  }

  async requestPasswordReset(email: string): Promise<PasswordRecoveryResponse> {
    try {
      const response = await fetch(`${API_CONFIG.baseUrl}/auth/forgot-password/send-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await response.json();
      return response.ok ? { success: true, message: data.message } : { success: false, message: data.message || 'Unable to send reset code.', code: data.code };
    } catch (error) {
      console.error('[MobileAuthService] Password reset request error:', error);
      return { success: false, message: 'Unable to reach the server.', code: 'NETWORK_ERROR' };
    }
  }

  async verifyPasswordResetOtp(email: string, otp: string): Promise<PasswordRecoveryResponse> {
    try {
      const response = await fetch(`${API_CONFIG.baseUrl}/auth/forgot-password/verify-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp }),
      });
      const data = await response.json();
      return response.ok && data.resetToken ? { success: true, resetToken: data.resetToken } : { success: false, message: data.message || 'Invalid or expired code.', code: data.code };
    } catch (error) {
      console.error('[MobileAuthService] Password reset OTP error:', error);
      return { success: false, message: 'Unable to reach the server.', code: 'NETWORK_ERROR' };
    }
  }

  async resetPassword(resetToken: string, newPassword: string): Promise<PasswordRecoveryResponse> {
    try {
      const response = await fetch(`${API_CONFIG.baseUrl}/auth/forgot-password/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, newPassword }),
      });
      const data = await response.json();
      return response.ok
        ? { success: true, message: data.message || 'Password reset successfully.' }
        : { success: false, message: Array.isArray(data.errors) ? data.errors.join('\n') : data.message || 'Unable to reset password.', code: data.code };
    } catch (error) {
      console.error('[MobileAuthService] Password reset error:', error);
      return { success: false, message: 'Unable to reach the server.', code: 'NETWORK_ERROR' };
    }
  }

  /**
   * Logout and clear stored credentials
   */
  async logout(): Promise<void> {
    try {
      this.token = null;
      this.user = null;

      await Promise.all([
        this.deleteStoredItem(STORAGE_KEYS.AUTH_TOKEN),
        this.deleteStoredItem(STORAGE_KEYS.USER_DATA),
      ]);
    } catch (error) {
      console.error('[MobileAuthService] Logout error:', error);
    }
  }

  /**
   * Validate the current token
   * Returns false ONLY if the server definitively rejects the token (HTTP 401/403).
   * Network errors or temporary 5xx errors return true to preserve offline/cached sessions.
   */
  async validateToken(): Promise<boolean> {
    if (!this.token) return false;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${API_CONFIG.baseUrl}/mobile-auth/me`, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
        },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        return false;
      }

      if (!response.ok) {
        // Server error (e.g. 500, 502, 503) - preserve local session
        return true;
      }

      const data = await response.json();

      if (data.success && data.data) {
        // Update user data
        this.user = data.data;
        await this.setStoredItem(STORAGE_KEYS.USER_DATA, JSON.stringify(data.data));
      }

      return true;
    } catch (error) {
      console.warn('[MobileAuthService] Token validation network/timeout error (session preserved):', error);
      // Network failure / offline / Render cold-start: do not wipe session
      return true;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Store credentials securely
   */
  private async storeCredentials(token: string, user: User): Promise<void> {
    this.token = token;
    this.user = user;

    await Promise.all([
      this.setStoredItem(STORAGE_KEYS.AUTH_TOKEN, token),
      this.setStoredItem(STORAGE_KEYS.USER_DATA, JSON.stringify(user)),
    ]);
  }

  private async getStoredItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  }

  private async setStoredItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  private async deleteStoredItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  }

  /**
   * Migrate old key names to the SecureStore-compliant key format.
   * This keeps existing dev sessions working after key rename.
   */
  private async migrateLegacyKeys(): Promise<void> {
    const [legacyToken, legacyUser] = await Promise.all([
      this.safeGetStoredItem(LEGACY_STORAGE_KEYS.AUTH_TOKEN),
      this.safeGetStoredItem(LEGACY_STORAGE_KEYS.USER_DATA),
    ]);

    if (legacyToken) {
      await this.setStoredItem(STORAGE_KEYS.AUTH_TOKEN, legacyToken);
      await this.safeDeleteStoredItem(LEGACY_STORAGE_KEYS.AUTH_TOKEN);
    }

    if (legacyUser) {
      await this.setStoredItem(STORAGE_KEYS.USER_DATA, legacyUser);
      await this.safeDeleteStoredItem(LEGACY_STORAGE_KEYS.USER_DATA);
    }
  }

  private async safeGetStoredItem(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  }

  private async safeDeleteStoredItem(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Ignore cleanup failures for legacy invalid keys
    }
  }

  /**
   * Create authenticated headers for API calls
   */
  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }

  /**
   * Make an authenticated API request
   */
  async authenticatedRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    if (!this.token) {
      return { success: false, error: 'Not authenticated' };
    }

    const controller = options.signal ? null : new AbortController();
    const timeoutId = controller ? setTimeout(() => controller.abort(), 10000) : null;

    try {
      const response = await fetch(`${API_CONFIG.baseUrl}${endpoint}`, {
        ...options,
        signal: options.signal || controller?.signal,
        headers: {
          ...this.getAuthHeaders(),
          ...options.headers,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle token expiration
        if (response.status === 401) {
          await this.logout();
          return { success: false, error: 'Session expired. Please log in again.' };
        }

        return { success: false, error: data.message || 'Request failed' };
      }

      return { success: true, data };
    } catch (error) {
      console.error('[MobileAuthService] Request error:', error);
      return { success: false, error: 'Network error' };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Update authenticated mobile user's profile fields.
   */
  async updateProfile(
    payload: UpdateMobileProfilePayload
  ): Promise<{ success: boolean; data?: User; error?: string }> {
    const response = await this.authenticatedRequest<{ success: boolean; data?: User; message?: string }>(
      '/mobile-auth/me',
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );

    if (!response.success || !response.data?.success || !response.data.data) {
      return {
        success: false,
        error: response.error || response.data?.message || 'Failed to update profile.',
      };
    }

    this.user = response.data.data;
    await this.setStoredItem(STORAGE_KEYS.USER_DATA, JSON.stringify(this.user));

    return {
      success: true,
      data: this.user,
    };
  }

  /**
   * Load scoped dashboard summary for volunteer/staff mobile users.
   */
  async getDashboardSummary(): Promise<{ success: boolean; data?: DashboardSummary; error?: string }> {
    const response = await this.authenticatedRequest<{
      success: boolean;
      data?: DashboardSummary;
      message?: string;
    }>('/mobile-auth/dashboard-summary', {
      method: 'GET',
    });

    if (!response.success || !response.data?.success || !response.data.data) {
      return {
        success: false,
        error: response.error || response.data?.message || 'Failed to load dashboard summary.',
      };
    }

    return {
      success: true,
      data: response.data.data,
    };
  }
}

// Export singleton instance
export const mobileAuthService = new MobileAuthService();

export default mobileAuthService;



