import { OperatorMobile } from "./operator-mobile";

export default async function OperatorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OperatorMobile eventId={id} />;
}
