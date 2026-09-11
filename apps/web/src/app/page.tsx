import AnonymousSession from "@/components/anonymous-session";
import CreatePairForm from "@/components/create-pair-form";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-12">
      <div className="mb-8 space-y-2">
        <h1 className="text-3xl font-semibold">Closer</h1>
        <p className="text-muted-foreground">Create a private space for two people to have better conversations.</p>
      </div>
      <AnonymousSession>
        <CreatePairForm />
      </AnonymousSession>
    </main>
  );
}
