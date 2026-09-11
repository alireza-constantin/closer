import { Loader2 } from "lucide-react";

export default function Loader() {
  return (
    <div className="flex min-h-32 items-center justify-center pt-8">
      <Loader2 aria-label="Loading" className="size-5 animate-spin text-closer-lavender" />
    </div>
  );
}
