import { Loader2 } from "lucide-react";

export default function Loader() {
  return (
    <div className="flex min-h-32 items-center justify-center pt-8">
      <Loader2 aria-label="Loading" className="text-closer-lavender size-5 animate-spin" />
    </div>
  );
}
