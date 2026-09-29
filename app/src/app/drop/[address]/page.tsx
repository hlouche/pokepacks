import { DropView } from "@/components/drop-view";

export default async function DropPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <DropView address={address} />;
}
