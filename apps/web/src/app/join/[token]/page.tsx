import AnonymousSession from "@/components/anonymous-session";
import JoinPairForm from "@/components/join-pair-form";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <main className="mx-auto w-full max-w-xl px-5 py-12">
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold">Join your pair</h1>
        <p className="text-muted-foreground">Choose the display name your pair will see.</p>
      </div>
      <AnonymousSession>
        <JoinPairForm token={token} />
      </AnonymousSession>
    </main>
  );
}
