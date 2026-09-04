import { redirect } from "next/navigation";

/** The app has no marketing page — send visitors to the board area, where
 *  middleware decides whether they see it or /login. */
export default function Home() {
  redirect("/boards");
}
