/**
 * Single list of account-screen strings (v2.4.0 sign-in).
 * The web app re-exports this from src/constants/accountCopy.ts.
 *
 * Plain stand-in copy. Tyler and Miranda replace it after sign-off.
 * Do not put bracketed placeholder tokens in these strings.
 *
 * Checkout (a later PR) returns EMAIL_NOT_VERIFIED_CODE when the
 * verified ID token's email_verified claim is false. The AI proxies
 * do not use that code.
 */

export const EMAIL_NOT_VERIFIED_CODE = "email_not_verified";
export const EMAIL_NOT_VERIFIED_MESSAGE = "Verify your email to continue.";

export const ACCOUNT_PASSWORD_MIN_LENGTH = 8;
export const ACCOUNT_DISPLAY_NAME_MAX = 40;

export const GOOGLE_PROVIDER_ID = "google.com";
export const PASSWORD_PROVIDER_ID = "password";

export function verificationSentBody(email: string): string {
  if (!email) {
    return "We sent a verification link. Verify your email to continue to payment.";
  }
  return `We sent a verification link to ${email}. Verify your email to continue to payment.`;
}

export const ACCOUNT_COPY = {
  title: "Sign in to continue",
  sub: "You need an account to buy and keep your results. Signing in doesn't change the price.",
  googleButton: "Continue with Google",
  googleBusy: "Signing in…",
  orEmail: "or use email",
  methodTabs: "Email sign in or sign up",
  tabSignIn: "Sign in",
  tabSignUp: "Create account",
  emailLabel: "Email",
  passwordLabel: "Password",
  displayNameLabel: "Display name (optional)",
  displayNameHelp: "Shown in the app only. You sign in with your email.",
  signInButton: "Sign in",
  signInBusy: "Signing in…",
  signUpButton: "Create account",
  signUpBusy: "Creating account…",
  forgot: "Forgot password?",
  resetTitle: "Reset your password",
  resetHelp: "Enter the email you sign in with.",
  resetButton: "Send reset link",
  resetBusy: "Sending…",
  resetSent: "If an account exists for that email, we've sent a reset link.",
  back: "Back",
  verifyTitle: "Verify your email",
  verifyContinue: "I've verified — continue",
  verifyChecking: "Checking…",
  verifyResend: "Resend email",
  verifyResending: "Sending…",
  verifyNotYet: "Not verified yet. Open the link in the email, then try again.",
  verifyResent: "Verification email sent.",
  verifyBanner: "Verify your email to continue to payment.",
  verifyBannerAction: "Verify email",
  passwordTooShort: "Use at least 8 characters.",
  invalidEmail: "Enter an email address.",
  displayNameTooLong: "Use 40 characters or fewer.",
  wrongCredentials: "That email and password don't match.",
  tooManyAttempts: "Too many tries. Wait a few minutes and try again.",
  unverified: EMAIL_NOT_VERIFIED_MESSAGE,
  googleCancelled: "Google sign-in didn't finish. Try again.",
  network: "Couldn't reach the server. Check your connection.",
  linkGoogle: "This email already has an account. Sign in with Google to link them.",
  linkPassword: "This email already has an account. Sign in with your password to link them.",
  linkEither: "This email already has an account. Sign in with Google or your password to link them.",
  linkUsePassword: "This email already has an account. Sign in with your password.",
  linkSubmit: "Sign in and link",
  signInWithPassword: "Sign in with your password",
  linkFailed: "We couldn't link the accounts. Sign in with the existing account so this stays one account.",
  emailMismatch: "That Google account uses a different email. Use the Google account for this address.",
  sendFailed: "Couldn't send the verification email. Use resend to try again.",
  generic: "Something went wrong. Try again.",
  close: "Close sign in",
  differentEmail: "Use a different email",
  menuSignIn: "Log In",
  menuVerify: "Verify email",
  verifyBody: verificationSentBody,
} as const;
