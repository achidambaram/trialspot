import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Dashboard } from "./dashboard";

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Auto-detect mobile devices and redirect to operator view
  const headersList = await headers();
  const ua = headersList.get("user-agent") || "";
  const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);

  if (isMobile) {
    redirect(`/event/${id}/operator`);
  }

  return <Dashboard eventId={id} />;
}
