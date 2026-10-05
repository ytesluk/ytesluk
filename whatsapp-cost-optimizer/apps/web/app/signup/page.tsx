import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

/** Public self-service signup. Terms/privacy URLs are read at runtime (the operator publishes them). */
export default function SignupPage() {
  return <SignupForm termsUrl={process.env.TERMS_URL || null} privacyUrl={process.env.PRIVACY_URL || null} />;
}
