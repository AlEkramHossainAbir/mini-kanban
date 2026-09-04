import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

// useSearchParams (for ?next=) needs a Suspense boundary, or the build fails
// prerendering this route.
export default function LoginPage() {
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
