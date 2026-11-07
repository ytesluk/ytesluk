import { redirect } from "next/navigation";

/** The optimization breakdown now lives at the bottom of the overview. */
export default function OptimizationPage() {
  redirect("/#economia");
}
